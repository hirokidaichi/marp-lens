import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { computeFileHash, fileExists } from "../src/utils/file-hash.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("file-hash utilities", () => {
  const tempDir = path.join(os.tmpdir(), `marp-lens-test-${Date.now()}`);
  const testFile1 = path.join(tempDir, "test1.md");
  const testFile2 = path.join(tempDir, "test2.md");

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(testFile1, "# Test Content\n\nHello World");
    fs.writeFileSync(testFile2, "# Different Content\n\nGoodbye World");
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("computeFileHash", () => {
    it("should compute MD5 hash of a file", () => {
      const hash = computeFileHash(testFile1);

      expect(hash).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should return same hash for same content", () => {
      const hash1 = computeFileHash(testFile1);
      const hash2 = computeFileHash(testFile1);

      expect(hash1).toBe(hash2);
    });

    it("should return different hash for different content", () => {
      const hash1 = computeFileHash(testFile1);
      const hash2 = computeFileHash(testFile2);

      expect(hash1).not.toBe(hash2);
    });

    it("should detect content changes", () => {
      const originalHash = computeFileHash(testFile1);

      // Modify the file
      const originalContent = fs.readFileSync(testFile1, "utf-8");
      fs.writeFileSync(testFile1, originalContent + "\n\nNew content");

      const newHash = computeFileHash(testFile1);

      expect(newHash).not.toBe(originalHash);

      // Restore original content
      fs.writeFileSync(testFile1, originalContent);
    });
  });

  describe("fileExists", () => {
    it("should return true for existing file", () => {
      expect(fileExists(testFile1)).toBe(true);
    });

    it("should return false for non-existing file", () => {
      expect(fileExists(path.join(tempDir, "nonexistent.md"))).toBe(false);
    });

    it("should return false for directory", () => {
      expect(fileExists(tempDir)).toBe(true); // directories are accessible
    });
  });
});
