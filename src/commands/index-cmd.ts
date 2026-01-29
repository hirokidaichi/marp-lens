import { glob } from "glob";
import path from "node:path";
import ora from "ora";
import chalk from "chalk";
import { SlideDatabase } from "../core/database.js";
import { GeminiClient } from "../core/gemini.js";
import { parseMarkdownFile } from "../core/parser.js";
import { computeFileHash, fileExists } from "../utils/file-hash.js";
import type { IndexOptions } from "../types/index.js";

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

  let totalSlides = 0;
  let totalImages = 0;
  let indexedFiles = 0;
  let skippedFiles = 0;

  for (const filePath of files) {
    const relativePath = path.relative(options.dir, filePath);
    const hash = computeFileHash(filePath);
    const existing = db.getFileByPath(relativePath);

    // Skip unchanged files
    if (existing && existing.hash === hash && !options.rebuild) {
      skippedFiles++;
      console.log(chalk.gray(`  Skipping unchanged: ${relativePath}`));
      continue;
    }

    const fileSpinner = ora(`Processing: ${relativePath}`).start();

    try {
      // Parse markdown file
      const doc = parseMarkdownFile(filePath);

      if (doc.slides.length === 0) {
        fileSpinner.warn(`No slides found: ${relativePath}`);
        continue;
      }

      // Upsert file record
      const fileId = db.upsertFile({
        path: relativePath,
        hash,
        title: doc.title,
        indexedAt: Date.now(),
      });

      // Collect all unique images from slides
      const allImages: Map<string, string> = new Map();
      if (options.withImages) {
        const slideDir = path.dirname(filePath);
        for (const slide of doc.slides) {
          for (const imgPath of slide.images) {
            const absoluteImgPath = path.resolve(slideDir, imgPath);
            if (fileExists(absoluteImgPath) && !allImages.has(absoluteImgPath)) {
              allImages.set(absoluteImgPath, imgPath);
            }
          }
        }

        if (allImages.size > 0) {
          fileSpinner.text = `Describing ${allImages.size} images...`;
          const descriptions = await gemini.describeImages(
            Array.from(allImages.keys())
          );
          allImages.forEach((_, absPath) => {
            const desc = descriptions.get(absPath) || "";
            allImages.set(absPath, desc);
          });
          totalImages += allImages.size;
        }
      }

      // Generate embeddings for all slides
      const texts = doc.slides.map((slide) => {
        // Get image descriptions for this slide
        const slideDir = path.dirname(filePath);
        const imageDescs = slide.images
          .map((imgPath) => {
            const absPath = path.resolve(slideDir, imgPath);
            return allImages.get(absPath) || "";
          })
          .filter(Boolean)
          .join(" ");

        // Combine heading, text, speaker notes, and image descriptions
        const parts = [
          slide.heading,
          slide.textOnly,
          slide.speakerNotes,
          imageDescs,
        ]
          .filter(Boolean)
          .join(" ");
        return parts || "(empty slide)";
      });

      fileSpinner.text = `Generating embeddings for ${texts.length} slides...`;
      const embeddings = await gemini.embedBatch(texts);

      // Insert slides with embeddings
      for (let i = 0; i < doc.slides.length; i++) {
        const slide = doc.slides[i];
        const slideDir = path.dirname(filePath);
        const imageDescriptions = slide.images
          .map((imgPath) => {
            const absPath = path.resolve(slideDir, imgPath);
            return allImages.get(absPath) || "";
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
          imageDescriptions,
          embedding: embeddings[i],
        });
      }

      totalSlides += doc.slides.length;
      indexedFiles++;

      const imageInfo =
        options.withImages && allImages.size > 0
          ? `, ${allImages.size} images`
          : "";
      fileSpinner.succeed(
        `Indexed: ${relativePath} (${doc.slides.length} slides${imageInfo})`
      );
    } catch (error) {
      fileSpinner.fail(`Failed: ${relativePath}`);
      console.error(chalk.red(`  Error: ${(error as Error).message}`));
    }
  }

  db.close();

  console.log("");
  console.log(chalk.green("Indexing complete!"));
  console.log(`  Files indexed: ${indexedFiles}`);
  console.log(`  Files skipped: ${skippedFiles}`);
  console.log(`  Total slides: ${totalSlides}`);
  if (options.withImages) {
    console.log(`  Total images: ${totalImages}`);
  }
  console.log(`  Database: ${options.db}`);
}
