import chalk from "chalk";
import { SlideDatabase } from "../core/database.js";
import { GeminiClient } from "../core/gemini.js";
import type { SearchOptions, SearchResult } from "../types/index.js";

export async function searchCommand(
  query: string,
  options: SearchOptions
): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error(
      chalk.red("Error: GEMINI_API_KEY environment variable is not set")
    );
    process.exit(1);
  }

  const db = new SlideDatabase(options.db);
  const gemini = new GeminiClient(apiKey);

  // Generate query embedding
  const queryEmbedding = await gemini.embed(query);

  // Search for similar slides
  const results = db.searchSimilar(queryEmbedding, options.limit);

  // Filter by threshold
  const filtered = results.filter((r) => r.similarity >= options.threshold);

  db.close();

  if (filtered.length === 0) {
    console.log(chalk.yellow("No matching slides found."));
    return;
  }

  if (options.format === "json") {
    console.log(JSON.stringify(filtered, null, 2));
  } else {
    printResultsCards(filtered, query);
  }
}

function printResultsCards(results: SearchResult[], query: string): void {
  console.log("");
  console.log(chalk.cyan.bold(`🔍 Search: "${query}"`));
  console.log(chalk.gray("─".repeat(60)));
  console.log("");

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const score = (result.similarity * 100).toFixed(1);
    const scoreColor = result.similarity >= 0.8 ? chalk.green :
                       result.similarity >= 0.6 ? chalk.yellow : chalk.gray;

    // Header line with rank, score, file and slide number
    console.log(
      chalk.white.bold(`[${i + 1}]`) + " " +
      scoreColor.bold(`${score}%`) + " " +
      chalk.gray("│") + " " +
      chalk.blue(result.filePath) + " " +
      chalk.magenta(`#${result.slideIndex + 1}`)
    );

    // Heading
    if (result.heading) {
      console.log(chalk.white.bold(`    ${result.heading}`));
    }

    // Content preview (wrapped and indented)
    const preview = truncate(result.textOnly, 200);
    const lines = wrapText(preview, 56);
    for (const line of lines) {
      console.log(chalk.gray(`    ${line}`));
    }

    // Separator between results
    if (i < results.length - 1) {
      console.log("");
    }
  }

  console.log("");
  console.log(chalk.gray("─".repeat(60)));
  console.log(chalk.gray(`Found ${results.length} matching slide(s)`));
  console.log("");
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.slice(0, 3); // Max 3 lines
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}
