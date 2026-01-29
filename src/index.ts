// Library exports
export { SlideDatabase } from "./core/database.js";
export { GeminiClient } from "./core/gemini.js";
export { parseMarkdownFile, parseMarkdownContent } from "./core/parser.js";
export { computeFileHash, fileExists } from "./utils/file-hash.js";

export type {
  ParsedSlide,
  ParsedDocument,
  FileRecord,
  SlideRecord,
  SlideWithEmbedding,
  SearchResult,
  DatabaseStats,
  IndexOptions,
  SearchOptions,
} from "./types/index.js";
