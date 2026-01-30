import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import fs from "node:fs";
import type {
  FileRecord,
  SlideRecord,
  SlideWithEmbedding,
  SearchResult,
  DatabaseStats,
} from "../types/index.js";

// Gemini text-embedding-004 produces 768-dimensional vectors
const EMBEDDING_DIMENSIONS = 768;

export class SlideDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      -- File tracking for incremental updates
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        hash TEXT NOT NULL,
        title TEXT,
        indexed_at INTEGER NOT NULL
      );

      -- Slide content and metadata
      CREATE TABLE IF NOT EXISTS slides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        slide_index INTEGER NOT NULL,
        heading TEXT,
        content TEXT NOT NULL,
        text_only TEXT NOT NULL,
        speaker_notes TEXT,
        image_descriptions TEXT,
        UNIQUE(file_id, slide_index)
      );

      -- Index for faster lookups
      CREATE INDEX IF NOT EXISTS idx_slides_file_id ON slides(file_id);
      CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);

      -- Metadata table for storing provider info
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // Create vector table if not exists
    const vecTableExists = this.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='slide_embeddings'`
      )
      .get();

    if (!vecTableExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE slide_embeddings USING vec0(
          embedding float[${EMBEDDING_DIMENSIONS}]
        );
      `);
    }
  }

  getFileByPath(path: string): FileRecord | null {
    const row = this.db
      .prepare("SELECT * FROM files WHERE path = ?")
      .get(path) as FileRecord | undefined;
    return row || null;
  }

  upsertFile(file: Omit<FileRecord, "id">): number {
    const existing = this.getFileByPath(file.path);

    if (existing) {
      // Delete existing slides and embeddings first
      this.deleteFileSlides(existing.id!);

      this.db
        .prepare(
          `UPDATE files SET hash = ?, title = ?, indexed_at = ? WHERE id = ?`
        )
        .run(file.hash, file.title, file.indexedAt, existing.id);
      return existing.id!;
    } else {
      const result = this.db
        .prepare(
          `INSERT INTO files (path, hash, title, indexed_at) VALUES (?, ?, ?, ?)`
        )
        .run(file.path, file.hash, file.title, file.indexedAt);
      return Number(result.lastInsertRowid);
    }
  }

  private deleteFileSlides(fileId: number): void {
    // Get slide IDs first
    const slideIds = this.db
      .prepare("SELECT id FROM slides WHERE file_id = ?")
      .all(fileId) as { id: number }[];

    // Delete embeddings
    for (const { id } of slideIds) {
      this.db
        .prepare("DELETE FROM slide_embeddings WHERE rowid = ?")
        .run(id);
    }

    // Delete slides
    this.db.prepare("DELETE FROM slides WHERE file_id = ?").run(fileId);
  }

  deleteFileByPath(path: string): boolean {
    const existing = this.getFileByPath(path);
    if (!existing) {
      return false;
    }

    this.deleteFileSlides(existing.id!);
    this.db.prepare("DELETE FROM files WHERE id = ?").run(existing.id);
    return true;
  }

  insertSlide(slide: Omit<SlideRecord, "id">): number {
    const result = this.db
      .prepare(
        `INSERT INTO slides (file_id, slide_index, heading, content, text_only, speaker_notes, image_descriptions)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        slide.fileId,
        slide.slideIndex,
        slide.heading,
        slide.content,
        slide.textOnly,
        slide.speakerNotes,
        slide.imageDescriptions
      );
    return Number(result.lastInsertRowid);
  }

  insertEmbedding(slideId: number, embedding: Float32Array): void {
    // sqlite-vec requires rowid as literal in SQL, not as parameter
    // Validate slideId is a safe integer to prevent SQL injection
    if (!Number.isInteger(slideId) || slideId < 0) {
      throw new Error(`Invalid slideId: ${slideId}`);
    }
    // Convert Float32Array to Buffer for better-sqlite3 to properly bind as BLOB
    const buffer = Buffer.from(
      embedding.buffer,
      embedding.byteOffset,
      embedding.byteLength
    );
    this.db
      .prepare(
        `INSERT INTO slide_embeddings (rowid, embedding) VALUES (${slideId}, ?)`
      )
      .run(buffer);
  }

  insertSlideWithEmbedding(slide: SlideWithEmbedding): number {
    const slideId = this.insertSlide(slide);
    this.insertEmbedding(slideId, slide.embedding);
    return slideId;
  }

  searchSimilar(queryEmbedding: Float32Array, limit: number): SearchResult[] {
    // Convert Float32Array to Buffer with proper offset and length
    const buffer = Buffer.from(
      queryEmbedding.buffer,
      queryEmbedding.byteOffset,
      queryEmbedding.byteLength
    );

    const rows = this.db
      .prepare(
        `
        SELECT
          s.id as slideId,
          s.slide_index as slideIndex,
          s.heading,
          s.content,
          s.text_only as textOnly,
          f.path as filePath,
          f.title as fileTitle,
          vec_distance_cosine(e.embedding, ?) as distance
        FROM slide_embeddings e
        JOIN slides s ON e.rowid = s.id
        JOIN files f ON s.file_id = f.id
        ORDER BY distance ASC
        LIMIT ?
      `
      )
      .all(buffer, limit) as Array<{
      slideId: number;
      slideIndex: number;
      heading: string | null;
      content: string;
      textOnly: string;
      filePath: string;
      fileTitle: string | null;
      distance: number;
    }>;

    return rows.map((row) => ({
      slideId: row.slideId,
      filePath: row.filePath,
      fileTitle: row.fileTitle,
      slideIndex: row.slideIndex,
      heading: row.heading,
      content: row.content,
      textOnly: row.textOnly,
      similarity: 1 - row.distance,
    }));
  }

  getSlideByPathAndIndex(
    filePath: string,
    slideIndex: number
  ): SlideRecord | null {
    // Try exact match first
    let row = this.db
      .prepare(
        `SELECT s.*, f.path as file_path
         FROM slides s
         JOIN files f ON s.file_id = f.id
         WHERE f.path = ? AND s.slide_index = ?`
      )
      .get(filePath, slideIndex) as (SlideRecord & { file_path: string }) | undefined;

    // If not found, try partial path match (e.g., "aiagent.md" matches "aiagent/aiagent.md")
    if (!row) {
      row = this.db
        .prepare(
          `SELECT s.*, f.path as file_path
           FROM slides s
           JOIN files f ON s.file_id = f.id
           WHERE f.path LIKE ? AND s.slide_index = ?`
        )
        .get(`%${filePath}`, slideIndex) as (SlideRecord & { file_path: string }) | undefined;
    }

    if (!row) return null;

    // Map snake_case SQL columns to camelCase TypeScript properties
    const dbRow = row as unknown as {
      id: number;
      file_id: number;
      slide_index: number;
      heading: string | null;
      content: string;
      text_only: string;
      speaker_notes: string;
      image_descriptions: string;
    };

    return {
      id: dbRow.id,
      fileId: dbRow.file_id,
      slideIndex: dbRow.slide_index,
      heading: dbRow.heading,
      content: dbRow.content,
      textOnly: dbRow.text_only,
      speakerNotes: dbRow.speaker_notes,
      imageDescriptions: dbRow.image_descriptions,
    };
  }

  listFiles(): FileRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM files ORDER BY path")
      .all() as FileRecord[];
    return rows;
  }

  getStats(): DatabaseStats {
    const totalFiles = (
      this.db.prepare("SELECT COUNT(*) as count FROM files").get() as {
        count: number;
      }
    ).count;
    const totalSlides = (
      this.db.prepare("SELECT COUNT(*) as count FROM slides").get() as {
        count: number;
      }
    ).count;
    const totalEmbeddings = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM slide_embeddings")
        .get() as { count: number }
    ).count;

    // Get database file size
    const dbPath = this.db.name;
    let dbSizeBytes = 0;
    try {
      const stats = fs.statSync(dbPath);
      dbSizeBytes = stats.size;
    } catch {
      // Ignore if file doesn't exist (in-memory db)
    }

    return {
      totalFiles,
      totalSlides,
      totalEmbeddings,
      dbSizeBytes,
    };
  }

  clear(): void {
    this.db.exec(`
      DELETE FROM slide_embeddings;
      DELETE FROM slides;
      DELETE FROM files;
    `);
  }

  close(): void {
    this.db.close();
  }
}
