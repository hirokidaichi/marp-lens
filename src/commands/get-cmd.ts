import chalk from "chalk";
import { SlideDatabase } from "../core/database.js";

export interface GetOptions {
  db: string;
}

export function getCommand(
  fileSlide: string,
  options: GetOptions
): void {
  // Parse input like "slides/aiagent.md #32" or "aiagent.md #32"
  const match = fileSlide.match(/^(.+?)\s*#(\d+)$/);
  if (!match) {
    console.error(
      chalk.red("Error: Invalid format. Use: get <file> #<slide-number>")
    );
    console.error(chalk.gray("Example: marpkit get slides/aiagent.md #32"));
    process.exit(1);
  }

  const filePath = match[1].trim();
  const slideNumber = parseInt(match[2], 10);
  const slideIndex = slideNumber - 1; // Convert to 0-based index

  if (slideIndex < 0) {
    console.error(chalk.red("Error: Slide number must be 1 or greater"));
    process.exit(1);
  }

  const db = new SlideDatabase(options.db);

  // Find matching file (support partial path matching)
  const slide = db.getSlideByPathAndIndex(filePath, slideIndex);

  if (!slide) {
    console.error(
      chalk.red(`Error: Slide not found: ${filePath} #${slideNumber}`)
    );

    // Show available files that match
    const files = db.listFiles();
    const matchingFiles = files.filter(f =>
      f.path.includes(filePath) || filePath.includes(f.path)
    );

    if (matchingFiles.length > 0) {
      console.log(chalk.yellow("\nDid you mean:"));
      for (const f of matchingFiles) {
        console.log(chalk.gray(`  ${f.path}`));
      }
    }

    db.close();
    process.exit(1);
  }

  db.close();

  // Output the slide content
  console.log(slide.content);
}
