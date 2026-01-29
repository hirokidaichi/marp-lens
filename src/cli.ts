#!/usr/bin/env node

import { program } from "commander";
import { config } from "dotenv";
import path from "node:path";
import { indexCommand } from "./commands/index-cmd.js";
import { searchCommand } from "./commands/search-cmd.js";
import { statsCommand } from "./commands/stats-cmd.js";
import { getCommand } from "./commands/get-cmd.js";

// Load .env file
config();

const DEFAULT_DIR = process.env.MARPKIT_DIR || process.cwd();
const DEFAULT_DB =
  process.env.MARPKIT_DB || path.resolve(process.cwd(), "marpkit.db");

program
  .name("marpkit")
  .description("Vector-based semantic search CLI for Marp presentations")
  .version("1.0.0");

program
  .command("index")
  .description("Index slides from markdown files")
  .option(
    "-d, --dir <path>",
    "Directory containing markdown files",
    DEFAULT_DIR
  )
  .option("--db <path>", "Database file path", DEFAULT_DB)
  .option("-f, --file <path>", "Index a specific file only")
  .option("-r, --rebuild", "Clear and rebuild the entire index", false)
  .option(
    "-i, --with-images",
    "Include image descriptions using Gemini Vision",
    false
  )
  .action(async (options) => {
    await indexCommand({
      dir: path.resolve(options.dir),
      db: path.resolve(options.db),
      file: options.file,
      rebuild: options.rebuild,
      withImages: options.withImages,
    });
  });

program
  .command("search <query>")
  .description("Search for similar slides")
  .option("-l, --limit <number>", "Maximum number of results", "10")
  .option(
    "-t, --threshold <number>",
    "Minimum similarity threshold (0-1)",
    "0"
  )
  .option("-o, --format <format>", "Output format (table|json)", "table")
  .option("--db <path>", "Database file path", DEFAULT_DB)
  .action(async (query, options) => {
    await searchCommand(query, {
      limit: parseInt(options.limit, 10),
      threshold: parseFloat(options.threshold),
      format: options.format as "json" | "table",
      db: path.resolve(options.db),
    });
  });

program
  .command("stats")
  .description("Show database statistics")
  .option("--db <path>", "Database file path", DEFAULT_DB)
  .action((options) => {
    statsCommand(path.resolve(options.db));
  });

program
  .command("get <file-slide>")
  .description("Get slide content by file path and slide number")
  .option("--db <path>", "Database file path", DEFAULT_DB)
  .action((fileSlide, options) => {
    getCommand(fileSlide, {
      db: path.resolve(options.db),
    });
  });

program.parse();
