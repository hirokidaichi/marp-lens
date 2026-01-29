export interface ParsedSlide {
  index: number;
  heading: string | null;
  content: string;
  textOnly: string;
  speakerNotes: string;
  images: string[];
}

export interface ParsedDocument {
  filePath: string;
  frontmatter: Record<string, unknown>;
  title: string;
  slides: ParsedSlide[];
}

export interface FileRecord {
  id?: number;
  path: string;
  hash: string;
  title: string | null;
  indexedAt: number;
}

export interface SlideRecord {
  id?: number;
  fileId: number;
  slideIndex: number;
  heading: string | null;
  content: string;
  textOnly: string;
  speakerNotes: string;
  imageDescriptions: string;
}

export interface SlideWithEmbedding extends SlideRecord {
  embedding: Float32Array;
}

export interface SearchResult {
  slideId: number;
  filePath: string;
  fileTitle: string | null;
  slideIndex: number;
  heading: string | null;
  content: string;
  textOnly: string;
  similarity: number;
}

export interface DatabaseStats {
  totalFiles: number;
  totalSlides: number;
  totalEmbeddings: number;
  dbSizeBytes: number;
}

export interface IndexOptions {
  dir: string;
  db: string;
  file?: string;
  rebuild: boolean;
  withImages: boolean;
}

export interface SearchOptions {
  limit: number;
  threshold: number;
  format: "json" | "table";
  db: string;
}

export interface WatchOptions {
  dir: string;
  db: string;
  withImages: boolean;
}
