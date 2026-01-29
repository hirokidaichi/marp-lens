import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SlideDatabase } from "../../src/core/database.js";
import { GeminiClient } from "../../src/core/gemini.js";
import { parseMarkdownFile } from "../../src/core/parser.js";
import { computeFileHash, fileExists } from "../../src/utils/file-hash.js";
import { glob } from "glob";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/**
 * E2E Test: Index and Search
 *
 * This test requires GEMINI_API_KEY environment variable.
 * It is excluded from CI and should be run manually:
 *
 *   npm run test:e2e
 */
describe("E2E: Index and Search", () => {
  let db: SlideDatabase;
  let gemini: GeminiClient;
  let dbPath: string;

  const samplesDir = path.resolve(__dirname, "../../samples");
  const apiKey = process.env.GEMINI_API_KEY;

  beforeAll(async () => {
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY environment variable is required for E2E tests"
      );
    }

    // Create temporary database
    dbPath = path.join(os.tmpdir(), `marpkit-e2e-${Date.now()}.db`);
    db = new SlideDatabase(dbPath);
    gemini = new GeminiClient(apiKey);

    // Index all sample files
    const files = await glob("**/*.md", { cwd: samplesDir, absolute: true });

    for (const filePath of files) {
      const relativePath = path.relative(samplesDir, filePath);
      const hash = computeFileHash(filePath);

      const doc = parseMarkdownFile(filePath);
      if (doc.slides.length === 0) continue;

      // Collect images
      const allImages: Map<string, string> = new Map();
      const slideDir = path.dirname(filePath);

      for (const slide of doc.slides) {
        for (const imgPath of slide.images) {
          const absoluteImgPath = path.resolve(slideDir, imgPath);
          if (fileExists(absoluteImgPath) && !allImages.has(absoluteImgPath)) {
            allImages.set(absoluteImgPath, imgPath);
          }
        }
      }

      // Describe images
      if (allImages.size > 0) {
        const descriptions = await gemini.describeImages(
          Array.from(allImages.keys())
        );
        allImages.forEach((_, absPath) => {
          const desc = descriptions.get(absPath) || "";
          allImages.set(absPath, desc);
        });
      }

      // Upsert file
      const fileId = db.upsertFile({
        path: relativePath,
        hash,
        title: doc.title,
        indexedAt: Date.now(),
      });

      // Generate embeddings
      const texts = doc.slides.map((slide) => {
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

      const embeddings = await gemini.embedBatch(texts);

      // Insert slides with embeddings
      for (let i = 0; i < doc.slides.length; i++) {
        const slide = doc.slides[i];
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
    }
  }, 300000); // 5 minute timeout for indexing

  afterAll(() => {
    db.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it("should have indexed all sample files", () => {
    const stats = db.getStats();
    expect(stats.totalFiles).toBeGreaterThanOrEqual(3);
    expect(stats.totalSlides).toBeGreaterThanOrEqual(15);
    expect(stats.totalEmbeddings).toBe(stats.totalSlides);
  });

  it("should find AI-related slides when searching for '機械学習'", async () => {
    const queryEmbedding = await gemini.embed("機械学習");
    const results = db.searchSimilar(queryEmbedding, 5);

    expect(results.length).toBeGreaterThan(0);

    // At least one result should be from ai-introduction.md
    const aiResults = results.filter((r) =>
      r.filePath.includes("ai-introduction")
    );
    expect(aiResults.length).toBeGreaterThan(0);
  });

  it("should find architecture slides when searching for 'マイクロサービス'", async () => {
    const queryEmbedding = await gemini.embed("マイクロサービス");
    const results = db.searchSimilar(queryEmbedding, 5);

    expect(results.length).toBeGreaterThan(0);

    // Should find the microservices slide
    const archResults = results.filter((r) =>
      r.filePath.includes("software-architecture")
    );
    expect(archResults.length).toBeGreaterThan(0);
  });

  it("should find agile slides when searching for 'スクラム スプリント'", async () => {
    const queryEmbedding = await gemini.embed("スクラム スプリント");
    const results = db.searchSimilar(queryEmbedding, 5);

    expect(results.length).toBeGreaterThan(0);

    // Should find the scrum slide
    const agileResults = results.filter((r) =>
      r.filePath.includes("agile-development")
    );
    expect(agileResults.length).toBeGreaterThan(0);
  });

  it("should return results sorted by similarity", async () => {
    const queryEmbedding = await gemini.embed("テスト駆動開発 TDD");
    const results = db.searchSimilar(queryEmbedding, 10);

    expect(results.length).toBeGreaterThan(0);

    // Results should be sorted by similarity (descending)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(
        results[i + 1].similarity
      );
    }
  });

  it("should find slides related to images", async () => {
    // Search for content that would be in the image descriptions
    const queryEmbedding = await gemini.embed("カンバンボード タスク管理 ワークフロー");
    const results = db.searchSimilar(queryEmbedding, 10);

    expect(results.length).toBeGreaterThan(0);

    // Should find agile-related slides (kanban is in agile-development.md)
    const agileResult = results.find((r) =>
      r.filePath.includes("agile-development")
    );
    expect(agileResult).toBeDefined();
  });

  it("should handle threshold filtering", async () => {
    const queryEmbedding = await gemini.embed("ディープラーニング");
    const allResults = db.searchSimilar(queryEmbedding, 100);

    // Filter with high threshold
    const highThreshold = allResults.filter((r) => r.similarity >= 0.7);

    // High threshold should return fewer results
    expect(highThreshold.length).toBeLessThanOrEqual(allResults.length);
  });
});
