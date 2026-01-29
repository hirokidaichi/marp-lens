import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SlideDatabase } from "../src/core/database.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("SlideDatabase", () => {
  let db: SlideDatabase;
  let dbPath: string;

  beforeEach(() => {
    // Create a temporary database file
    dbPath = path.join(os.tmpdir(), `marpkit-test-${Date.now()}.db`);
    db = new SlideDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    // Clean up temp file
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  describe("file operations", () => {
    it("should insert and retrieve a file", () => {
      const fileId = db.upsertFile({
        path: "test/slides.md",
        hash: "abc123",
        title: "Test Slides",
        indexedAt: Date.now(),
      });

      const retrieved = db.getFileByPath("test/slides.md");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.path).toBe("test/slides.md");
      expect(retrieved!.hash).toBe("abc123");
      expect(retrieved!.title).toBe("Test Slides");
    });

    it("should update existing file on upsert", () => {
      db.upsertFile({
        path: "test/slides.md",
        hash: "hash1",
        title: "Original Title",
        indexedAt: Date.now(),
      });

      db.upsertFile({
        path: "test/slides.md",
        hash: "hash2",
        title: "Updated Title",
        indexedAt: Date.now(),
      });

      const retrieved = db.getFileByPath("test/slides.md");

      expect(retrieved!.hash).toBe("hash2");
      expect(retrieved!.title).toBe("Updated Title");
    });

    it("should list all files", () => {
      db.upsertFile({
        path: "a/first.md",
        hash: "h1",
        title: "First",
        indexedAt: Date.now(),
      });
      db.upsertFile({
        path: "b/second.md",
        hash: "h2",
        title: "Second",
        indexedAt: Date.now(),
      });

      const files = db.listFiles();

      expect(files).toHaveLength(2);
      expect(files[0].path).toBe("a/first.md");
      expect(files[1].path).toBe("b/second.md");
    });
  });

  describe("slide operations", () => {
    it("should insert a slide", () => {
      const fileId = db.upsertFile({
        path: "test.md",
        hash: "h1",
        title: "Test",
        indexedAt: Date.now(),
      });

      const slideId = db.insertSlide({
        fileId,
        slideIndex: 0,
        heading: "First Slide",
        content: "# First Slide\n\nContent",
        textOnly: "First Slide Content",
        speakerNotes: "Notes here",
        imageDescriptions: "",
      });

      expect(slideId).toBeGreaterThan(0);
    });

    it("should insert slide with embedding", () => {
      const fileId = db.upsertFile({
        path: "test.md",
        hash: "h1",
        title: "Test",
        indexedAt: Date.now(),
      });

      // Create a mock 768-dimensional embedding (Gemini uses 768)
      const embedding = new Float32Array(768);
      for (let i = 0; i < 768; i++) {
        embedding[i] = Math.random();
      }

      const slideId = db.insertSlideWithEmbedding({
        fileId,
        slideIndex: 0,
        heading: "Test Slide",
        content: "Content",
        textOnly: "Text only",
        speakerNotes: "",
        imageDescriptions: "",
        embedding,
      });

      expect(slideId).toBeGreaterThan(0);
    });

    it("should retrieve slide by path and index", () => {
      const fileId = db.upsertFile({
        path: "slides/presentation.md",
        hash: "h1",
        title: "Presentation",
        indexedAt: Date.now(),
      });

      db.insertSlide({
        fileId,
        slideIndex: 0,
        heading: "Slide 0",
        content: "Content 0",
        textOnly: "Text 0",
        speakerNotes: "",
        imageDescriptions: "",
      });

      db.insertSlide({
        fileId,
        slideIndex: 1,
        heading: "Slide 1",
        content: "Content 1",
        textOnly: "Text 1",
        speakerNotes: "",
        imageDescriptions: "",
      });

      const slide = db.getSlideByPathAndIndex("slides/presentation.md", 1);

      expect(slide).not.toBeNull();
      expect(slide!.heading).toBe("Slide 1");
      expect(slide!.slideIndex).toBe(1);
    });

    it("should support partial path matching", () => {
      const fileId = db.upsertFile({
        path: "slides/subfolder/presentation.md",
        hash: "h1",
        title: "Presentation",
        indexedAt: Date.now(),
      });

      db.insertSlide({
        fileId,
        slideIndex: 0,
        heading: "Test Slide",
        content: "Content",
        textOnly: "Text",
        speakerNotes: "",
        imageDescriptions: "",
      });

      const slide = db.getSlideByPathAndIndex("presentation.md", 0);

      expect(slide).not.toBeNull();
      expect(slide!.heading).toBe("Test Slide");
    });
  });

  describe("search operations", () => {
    it("should search for similar slides", () => {
      const fileId = db.upsertFile({
        path: "test.md",
        hash: "h1",
        title: "Test",
        indexedAt: Date.now(),
      });

      // Insert multiple slides with embeddings
      for (let i = 0; i < 3; i++) {
        const embedding = new Float32Array(768);
        for (let j = 0; j < 768; j++) {
          embedding[j] = i === 0 ? 0.5 : Math.random() * 0.1;
        }

        db.insertSlideWithEmbedding({
          fileId,
          slideIndex: i,
          heading: `Slide ${i}`,
          content: `Content ${i}`,
          textOnly: `Text ${i}`,
          speakerNotes: "",
          imageDescriptions: "",
          embedding,
        });
      }

      // Search with a query embedding similar to slide 0
      const queryEmbedding = new Float32Array(768);
      for (let i = 0; i < 768; i++) {
        queryEmbedding[i] = 0.5;
      }

      const results = db.searchSimilar(queryEmbedding, 3);

      expect(results).toHaveLength(3);
      expect(results[0].slideIndex).toBe(0); // Most similar should be slide 0
      expect(results[0].similarity).toBeGreaterThan(0.9);
    });
  });

  describe("statistics", () => {
    it("should return correct stats", () => {
      const fileId = db.upsertFile({
        path: "test.md",
        hash: "h1",
        title: "Test",
        indexedAt: Date.now(),
      });

      for (let i = 0; i < 5; i++) {
        const embedding = new Float32Array(768).fill(0.1);
        db.insertSlideWithEmbedding({
          fileId,
          slideIndex: i,
          heading: `Slide ${i}`,
          content: `Content ${i}`,
          textOnly: `Text ${i}`,
          speakerNotes: "",
          imageDescriptions: "",
          embedding,
        });
      }

      const stats = db.getStats();

      expect(stats.totalFiles).toBe(1);
      expect(stats.totalSlides).toBe(5);
      expect(stats.totalEmbeddings).toBe(5);
      expect(stats.dbSizeBytes).toBeGreaterThan(0);
    });
  });

  describe("clear operation", () => {
    it("should clear all data", () => {
      const fileId = db.upsertFile({
        path: "test.md",
        hash: "h1",
        title: "Test",
        indexedAt: Date.now(),
      });

      const embedding = new Float32Array(768).fill(0.1);
      db.insertSlideWithEmbedding({
        fileId,
        slideIndex: 0,
        heading: "Test",
        content: "Content",
        textOnly: "Text",
        speakerNotes: "",
        imageDescriptions: "",
        embedding,
      });

      db.clear();

      const stats = db.getStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSlides).toBe(0);
      expect(stats.totalEmbeddings).toBe(0);
    });
  });
});
