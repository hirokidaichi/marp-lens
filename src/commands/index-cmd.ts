import { glob } from "glob";
import path from "node:path";
import ora from "ora";
import chalk from "chalk";
import { SlideDatabase } from "../core/database.js";
import { GeminiClient } from "../core/gemini.js";
import { parseMarkdownFile } from "../core/parser.js";
import { computeFileHash, fileExists } from "../utils/file-hash.js";
import type { IndexOptions, ParsedDocument, ParsedSlide } from "../types/index.js";

// Collected data for batch processing
interface FileData {
  filePath: string;
  relativePath: string;
  hash: string;
  doc: ParsedDocument;
  imageDescriptions: Map<string, string>;
}

interface SlideTextEntry {
  fileIndex: number;
  slideIndex: number;
  text: string;
}

export async function indexCommand(options: IndexOptions): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error(
      chalk.red("Error: GEMINI_API_KEY environment variable is not set")
    );
    process.exit(1);
  }

  const spinner = ora("Initializing database...").start();

  const db = new SlideDatabase(options.db);
  const gemini = new GeminiClient(apiKey);

  if (options.rebuild) {
    spinner.text = "Clearing existing data...";
    db.clear();
  }

  // Find markdown files
  spinner.text = "Scanning for markdown files...";
  const files = options.file
    ? [path.resolve(options.file)]
    : await glob("**/*.md", { cwd: options.dir, absolute: true });

  spinner.succeed(`Found ${files.length} markdown file(s)`);

  // Phase 1: Parse all files and collect data
  spinner.start("Phase 1: Parsing files and collecting images...");
  const fileDataList: FileData[] = [];
  const allImagePaths: string[] = [];
  let skippedFiles = 0;

  for (const filePath of files) {
    const relativePath = path.relative(options.dir, filePath);
    const hash = computeFileHash(filePath);
    const existing = db.getFileByPath(relativePath);

    // Skip unchanged files
    if (existing && existing.hash === hash && !options.rebuild) {
      skippedFiles++;
      continue;
    }

    try {
      const doc = parseMarkdownFile(filePath);
      if (doc.slides.length === 0) continue;

      const imageDescriptions = new Map<string, string>();

      // Collect images from this file
      if (options.withImages) {
        const slideDir = path.dirname(filePath);
        for (const slide of doc.slides) {
          for (const imgPath of slide.images) {
            const absoluteImgPath = path.resolve(slideDir, imgPath);
            if (fileExists(absoluteImgPath) && !imageDescriptions.has(absoluteImgPath)) {
              imageDescriptions.set(absoluteImgPath, "");
              allImagePaths.push(absoluteImgPath);
            }
          }
        }
      }

      fileDataList.push({ filePath, relativePath, hash, doc, imageDescriptions });
    } catch (error) {
      console.log(chalk.red(`  Failed to parse: ${relativePath}`));
    }
  }

  spinner.succeed(
    `Phase 1: Parsed ${fileDataList.length} files (${skippedFiles} skipped)`
  );

  if (fileDataList.length === 0) {
    console.log(chalk.yellow("No files to index."));
    db.close();
    return;
  }

  // Phase 2: Describe all images (if enabled)
  let totalImages = 0;
  if (options.withImages && allImagePaths.length > 0) {
    spinner.start(`Phase 2: Describing ${allImagePaths.length} images...`);
    const descriptions = await gemini.describeImages(
      allImagePaths,
      (completed, total) => {
        spinner.text = `Phase 2: Describing images... (${completed}/${total})`;
      }
    );

    // Distribute descriptions back to file data
    for (const fileData of fileDataList) {
      for (const [absPath] of fileData.imageDescriptions) {
        const desc = descriptions.get(absPath) || "";
        fileData.imageDescriptions.set(absPath, desc);
      }
    }

    totalImages = allImagePaths.length;
    spinner.succeed(`Phase 2: Described ${totalImages} images`);
  }

  // Phase 3: Collect all slide texts for batch embedding
  spinner.start("Phase 3: Generating embeddings for all slides...");
  const slideTextEntries: SlideTextEntry[] = [];

  for (let fileIndex = 0; fileIndex < fileDataList.length; fileIndex++) {
    const { filePath, doc, imageDescriptions } = fileDataList[fileIndex];
    const slideDir = path.dirname(filePath);

    for (const slide of doc.slides) {
      const imageDescs = slide.images
        .map((imgPath) => {
          const absPath = path.resolve(slideDir, imgPath);
          return imageDescriptions.get(absPath) || "";
        })
        .filter(Boolean)
        .join(" ");

      const parts = [slide.heading, slide.textOnly, slide.speakerNotes, imageDescs]
        .filter(Boolean)
        .join(" ");

      slideTextEntries.push({
        fileIndex,
        slideIndex: slide.index,
        text: parts || "(empty slide)",
      });
    }
  }

  // Generate embeddings for all slides in parallel batches
  const allTexts = slideTextEntries.map((e) => e.text);
  const embeddings = await gemini.embedBatch(allTexts, (completed, total) => {
    spinner.text = `Phase 3: Generating embeddings... (${completed}/${total})`;
  });

  spinner.succeed(`Phase 3: Generated ${embeddings.length} embeddings`);

  // Phase 4: Save to database
  spinner.start("Phase 4: Saving to database...");
  let totalSlides = 0;

  for (let fileIndex = 0; fileIndex < fileDataList.length; fileIndex++) {
    const { filePath, relativePath, hash, doc, imageDescriptions } =
      fileDataList[fileIndex];
    const slideDir = path.dirname(filePath);

    const fileId = db.upsertFile({
      path: relativePath,
      hash,
      title: doc.title,
      indexedAt: Date.now(),
    });

    for (const slide of doc.slides) {
      const embeddingIndex = slideTextEntries.findIndex(
        (e) => e.fileIndex === fileIndex && e.slideIndex === slide.index
      );

      const slideImageDescs = slide.images
        .map((imgPath) => {
          const absPath = path.resolve(slideDir, imgPath);
          return imageDescriptions.get(absPath) || "";
        })
        .filter(Boolean)
        .join("\n");

      db.insertSlideWithEmbedding({
        fileId,
        slideIndex: slide.index,
        heading: slide.heading,
        content: slide.content,
        textOnly: slide.textOnly,
        speakerNotes: slide.speakerNotes,
        imageDescriptions: slideImageDescs,
        embedding: embeddings[embeddingIndex],
      });

      totalSlides++;
    }
  }

  spinner.succeed(`Phase 4: Saved ${totalSlides} slides to database`);

  db.close();

  console.log("");
  console.log(chalk.green("Indexing complete!"));
  console.log(`  Files indexed: ${fileDataList.length}`);
  console.log(`  Files skipped: ${skippedFiles}`);
  console.log(`  Total slides: ${totalSlides}`);
  if (options.withImages) {
    console.log(`  Total images: ${totalImages}`);
  }
  console.log(`  Database: ${options.db}`);
}
