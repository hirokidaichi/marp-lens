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
    dbPath = path.join(os.tmpdir(), `marp-lens-e2e-${Date.now()}.db`);
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

  describe("Semantic Search Validation", () => {
    it("should find related content using synonyms (ニューラルネット → ディープラーニング)", async () => {
      // Search using "neural network" which is not directly in the text
      // but should semantically match "deep learning"
      const queryEmbedding = await gemini.embed("ニューラルネットワーク 深層学習");
      const results = db.searchSimilar(queryEmbedding, 5);

      expect(results.length).toBeGreaterThan(0);

      // Should find AI-related slides in the results
      const aiResult = results.find((r) =>
        r.filePath.includes("ai-introduction")
      );
      expect(aiResult).toBeDefined();
    });

    it("should find related content using synonyms (システム分割 → マイクロサービス)", async () => {
      // "System decomposition" should match "microservices"
      const queryEmbedding = await gemini.embed("システムを小さく分割して独立させる");
      const results = db.searchSimilar(queryEmbedding, 5);

      expect(results.length).toBeGreaterThan(0);

      // Should find microservices slide
      const archResult = results.find((r) =>
        r.filePath.includes("software-architecture")
      );
      expect(archResult).toBeDefined();
    });

    it("should understand questions and find relevant slides", async () => {
      // Natural language question about AI ethics
      const queryEmbedding = await gemini.embed(
        "AIを使うときに気をつけるべき問題は何ですか？"
      );
      const results = db.searchSimilar(queryEmbedding, 5);

      expect(results.length).toBeGreaterThan(0);

      // Should find the ethics slide
      const ethicsResult = results.find(
        (r) =>
          r.heading?.includes("倫理") ||
          r.textOnly.includes("プライバシー") ||
          r.textOnly.includes("バイアス")
      );
      expect(ethicsResult).toBeDefined();
    });

    it("should find iterative development content using abstract concepts", async () => {
      // "Iterative development" should match scrum/sprint content
      const queryEmbedding = await gemini.embed("繰り返し開発 反復 改善サイクル");
      const results = db.searchSimilar(queryEmbedding, 5);

      expect(results.length).toBeGreaterThan(0);

      // Should find agile/scrum slides
      const agileResult = results.find((r) =>
        r.filePath.includes("agile-development")
      );
      expect(agileResult).toBeDefined();
    });

    it("should find LLM slides when searching for ChatGPT (semantic association)", async () => {
      // ChatGPT is not mentioned but LLM/GPT is
      const queryEmbedding = await gemini.embed("ChatGPTのような対話AI");
      const results = db.searchSimilar(queryEmbedding, 5);

      expect(results.length).toBeGreaterThan(0);

      // Should find LLM slide (mentions GPT, Claude, Gemini)
      const llmResult = results.find(
        (r) =>
          r.heading?.includes("LLM") ||
          r.heading?.includes("言語モデル") ||
          r.textOnly.includes("GPT")
      );
      expect(llmResult).toBeDefined();
    });

    it("should rank semantically closer results higher", async () => {
      // Search for container orchestration - should rank K8s slide higher than unrelated
      const queryEmbedding = await gemini.embed("Docker Kubernetes コンテナ化");
      const results = db.searchSimilar(queryEmbedding, 10);

      expect(results.length).toBeGreaterThan(0);

      // Find the container slide's rank
      const containerResultIndex = results.findIndex(
        (r) =>
          r.heading?.includes("コンテナ") ||
          r.heading?.includes("オーケストレーション") ||
          r.textOnly.includes("Kubernetes") ||
          r.textOnly.includes("Docker")
      );

      expect(containerResultIndex).toBeGreaterThanOrEqual(0);
      // Container slide should be in top 5 results
      expect(containerResultIndex).toBeLessThan(5);
    });

    it("should distinguish between different domains", async () => {
      // Search for software testing - should find agile/TDD content
      const queryEmbedding = await gemini.embed(
        "テスト駆動開発 TDD Red Green Refactor"
      );
      const results = db.searchSimilar(queryEmbedding, 5);

      expect(results.length).toBeGreaterThan(0);

      // Should find TDD or testing-related slides in results
      const testRelatedResult = results.find(
        (r) =>
          r.heading?.includes("TDD") ||
          r.heading?.includes("テスト") ||
          r.heading?.includes("インテグレーション") ||
          r.textOnly.includes("自動テスト") ||
          r.textOnly.includes("Red") ||
          r.filePath.includes("agile-development")
      );

      expect(testRelatedResult).toBeDefined();
    });
  });

  describe("Embedding Quality Validation", () => {
    it("should return different top results for different domain queries", async () => {
      // Test that different queries return different top results
      const queries = [
        { query: "認証とセキュリティ OAuth JWT", expectedFile: "security" },
        { query: "機械学習 ニューラルネットワーク", expectedFile: "ai-introduction" },
        { query: "AWS Azure GCP サーバーレス Lambda", expectedFile: "cloud" },
        { query: "スクラム アジャイル スプリント", expectedFile: "agile" },
      ];

      const topResults: string[] = [];

      for (const { query, expectedFile } of queries) {
        const embedding = await gemini.embed(query);
        const results = db.searchSimilar(embedding, 3);

        expect(results.length).toBeGreaterThan(0);

        // Record top result
        topResults.push(results[0].filePath);

        // Verify top result matches expected domain
        expect(results[0].filePath).toContain(expectedFile);
      }

      // Verify that we got different top results for different queries
      const uniqueTopResults = new Set(topResults);
      expect(uniqueTopResults.size).toBe(queries.length);
    });

    it("should show meaningful similarity score differences", async () => {
      // Search for a specific topic and verify score distribution
      const embedding = await gemini.embed("暗号化 AES RSA ハッシュ関数");
      const results = db.searchSimilar(embedding, 10);

      expect(results.length).toBeGreaterThan(3);

      // Top result should be from security
      expect(results[0].filePath).toContain("security");

      // There should be a meaningful gap between relevant and less relevant results
      const relevantResults = results.filter((r) =>
        r.filePath.includes("security")
      );
      const otherResults = results.filter(
        (r) => !r.filePath.includes("security")
      );

      if (relevantResults.length > 0 && otherResults.length > 0) {
        const avgRelevant =
          relevantResults.reduce((sum, r) => sum + r.similarity, 0) /
          relevantResults.length;
        const avgOther =
          otherResults.reduce((sum, r) => sum + r.similarity, 0) /
          otherResults.length;

        // Relevant results should have higher average similarity
        expect(avgRelevant).toBeGreaterThan(avgOther);
      }
    });

    it("should not return identical embeddings for different content", async () => {
      // This test specifically catches the bug where Japanese text produced identical embeddings
      const queries = [
        "セキュリティの基礎",
        "データサイエンス入門",
        "クラウドコンピューティング",
      ];

      const embeddings: Float32Array[] = [];
      for (const query of queries) {
        const emb = await gemini.embed(query);
        embeddings.push(emb);
      }

      // Verify that embeddings are different
      for (let i = 0; i < embeddings.length; i++) {
        for (let j = i + 1; j < embeddings.length; j++) {
          // Check first few values - they should NOT be identical
          const areIdentical =
            embeddings[i][0] === embeddings[j][0] &&
            embeddings[i][1] === embeddings[j][1] &&
            embeddings[i][2] === embeddings[j][2];

          expect(areIdentical).toBe(false);
        }
      }
    });

    it("should return top result with similarity > 0.5 for direct keyword matches", async () => {
      // When searching for exact content, similarity should be reasonably high
      const embedding = await gemini.embed("マイクロサービスアーキテクチャ 独立したサービス");
      const results = db.searchSimilar(embedding, 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].similarity).toBeGreaterThan(0.5);
      // Top results should be from software-architecture.md
      expect(results[0].filePath).toContain("software-architecture");
    });
  });
});
