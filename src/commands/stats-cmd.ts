import chalk from "chalk";
import Table from "cli-table3";
import { SlideDatabase } from "../core/database.js";

export function statsCommand(dbPath: string): void {
  const db = new SlideDatabase(dbPath);
  const stats = db.getStats();
  db.close();

  console.log("");
  console.log(chalk.cyan("Database Statistics"));
  console.log("");

  const table = new Table({
    colWidths: [25, 20],
  });

  table.push(
    [chalk.bold("Total Files"), stats.totalFiles.toString()],
    [chalk.bold("Total Slides"), stats.totalSlides.toString()],
    [chalk.bold("Total Embeddings"), stats.totalEmbeddings.toString()],
    [chalk.bold("Database Size"), formatBytes(stats.dbSizeBytes)]
  );

  console.log(table.toString());
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
