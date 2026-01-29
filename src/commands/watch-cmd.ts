import chokidar from "chokidar";
import path from "node:path";
import chalk from "chalk";
import { SlideDatabase } from "../core/database.js";
import { GeminiClient } from "../core/gemini.js";
import { parseMarkdownFile } from "../core/parser.js";
import { computeFileHash, fileExists } from "../utils/file-hash.js";
import type { WatchOptions } from "../types/index.js";

export async function watchCommand(options: WatchOptions): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error(
      chalk.red("Error: GEMINI_API_KEY environment variable is not set")
    );
    process.exit(1);
  }

  const db = new SlideDatabase(options.db);
  const gemini = new GeminiClient(apiKey);

  console.log(chalk.cyan.bold("marp-lens watch"));
  console.log(chalk.gray("─".repeat(50)));
  console.log(`  Directory: ${chalk.white(path.resolve(options.dir))}`);
  console.log(`  Database:  ${chalk.white(options.db)}`);
  console.log(`  Images:    ${chalk.white(options.withImages ? "Yes" : "No")}`);
  console.log(chalk.gray("─".repeat(50)));
  console.log("");
  console.log(chalk.yellow("Watching for changes... (Ctrl+C to stop)"));
  console.log("");

  // Track files being processed to avoid duplicate processing
  const processing = new Set<string>();

  const watcher = chokidar.watch("**/*.md", {
    cwd: options.dir,
    ignored: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  const indexFile = async (relativePath: string, eventType: string) => {
    const absolutePath = path.resolve(options.dir, relativePath);

    // Skip if already processing
    if (processing.has(absolutePath)) {
      return;
    }

    processing.add(absolutePath);

    try {
      const timestamp = new Date().toLocaleTimeString();
      const eventColor =
        eventType === "add"
          ? chalk.green
          : eventType === "change"
            ? chalk.yellow
            : chalk.red;

      console.log(
        `${chalk.gray(timestamp)} ${eventColor(`[${eventType}]`)} ${relativePath}`
      );

      if (eventType === "unlink") {
        // File was deleted - remove from database
        db.deleteFileByPath(relativePath);
        console.log(chalk.gray(`  Removed from index`));
        return;
      }

      // Check if file exists and is readable
      if (!fileExists(absolutePath)) {
        return;
      }

      const hash = computeFileHash(absolutePath);
      const existing = db.getFileByPath(relativePath);

      // Skip if unchanged
      if (existing && existing.hash === hash) {
        console.log(chalk.gray(`  No changes detected`));
        return;
      }

      // Parse the markdown file
      const doc = parseMarkdownFile(absolutePath);

      if (doc.slides.length === 0) {
        console.log(chalk.gray(`  No slides found`));
        return;
      }

      // Collect images
      const allImages: Map<string, string> = new Map();
      if (options.withImages) {
        const slideDir = path.dirname(absolutePath);
        for (const slide of doc.slides) {
          for (const imgPath of slide.images) {
            const absoluteImgPath = path.resolve(slideDir, imgPath);
            if (
              fileExists(absoluteImgPath) &&
              !allImages.has(absoluteImgPath)
            ) {
              allImages.set(absoluteImgPath, imgPath);
            }
          }
        }

        if (allImages.size > 0) {
          console.log(chalk.gray(`  Describing ${allImages.size} images...`));
          const descriptions = await gemini.describeImages(
            Array.from(allImages.keys())
          );
          allImages.forEach((_, absPath) => {
            const desc = descriptions.get(absPath) || "";
            allImages.set(absPath, desc);
          });
        }
      }

      // Upsert file record
      const fileId = db.upsertFile({
        path: relativePath,
        hash,
        title: doc.title,
        indexedAt: Date.now(),
      });

      // Generate embeddings
      const texts = doc.slides.map((slide) => {
        const slideDir = path.dirname(absolutePath);
        const imageDescs = slide.images
          .map((imgPath) => {
            const absPath = path.resolve(slideDir, imgPath);
            return allImages.get(absPath) || "";
          })
          .filter(Boolean)
          .join(" ");

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

      console.log(
        chalk.gray(`  Generating embeddings for ${texts.length} slides...`)
      );
      const embeddings = await gemini.embedBatch(texts);

      // Insert slides with embeddings
      for (let i = 0; i < doc.slides.length; i++) {
        const slide = doc.slides[i];
        const slideDir = path.dirname(absolutePath);
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

      const imageInfo =
        options.withImages && allImages.size > 0
          ? `, ${allImages.size} images`
          : "";
      console.log(
        chalk.green(`  Indexed: ${doc.slides.length} slides${imageInfo}`)
      );
    } catch (error) {
      console.error(chalk.red(`  Error: ${(error as Error).message}`));
    } finally {
      processing.delete(absolutePath);
    }
  };

  watcher
    .on("add", (relativePath) => indexFile(relativePath, "add"))
    .on("change", (relativePath) => indexFile(relativePath, "change"))
    .on("unlink", (relativePath) => indexFile(relativePath, "unlink"));

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("");
    console.log(chalk.yellow("Stopping watch mode..."));
    watcher.close();
    db.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    watcher.close();
    db.close();
    process.exit(0);
  });
}
