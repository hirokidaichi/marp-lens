import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs";
import path from "node:path";

// Latest Gemini embedding model (3072 dimensions, multilingual support)
const EMBEDDING_MODEL = "gemini-embedding-001";
const VISION_MODEL = "gemini-2.0-flash";

// Maximum batch size for batchEmbedContents API
const EMBEDDING_BATCH_SIZE = 100;

export class GeminiClient {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async embed(text: string): Promise<Float32Array> {
    const model = this.genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    return new Float32Array(result.embedding.values);
  }

  async embedBatch(
    texts: string[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<Float32Array[]> {
    const model = this.genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const results: Float32Array[] = new Array(texts.length);
    let completed = 0;

    // Process in chunks using batchEmbedContents API (max 100 per request)
    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      const chunk = texts.slice(i, i + EMBEDDING_BATCH_SIZE);

      const response = await model.batchEmbedContents({
        requests: chunk.map((text) => ({
          content: { role: "user", parts: [{ text }] },
        })),
      });

      // Store results in correct positions
      for (let j = 0; j < response.embeddings.length; j++) {
        results[i + j] = new Float32Array(response.embeddings[j].values);
        completed++;
        if (onProgress) {
          onProgress(completed, texts.length);
        }
      }

      // Small delay between chunks to avoid rate limiting
      if (i + EMBEDDING_BATCH_SIZE < texts.length) {
        await sleep(50);
      }
    }

    return results;
  }

  async describeImage(imagePath: string): Promise<string> {
    const model = this.genAI.getGenerativeModel({ model: VISION_MODEL });

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = getMimeType(imagePath);

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
      {
        text: "この画像の内容を詳細に説明してください。スライドの文脈で検索に役立つようなキーワードを含めてください。",
      },
    ]);

    return result.response.text();
  }

  async describeImages(
    imagePaths: string[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, string>> {
    const descriptions = new Map<string, string>();

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];
      try {
        const description = await this.describeImage(imagePath);
        descriptions.set(imagePath, description);
      } catch (error) {
        console.warn(`Failed to describe image: ${imagePath}`);
        descriptions.set(imagePath, "");
      }

      if (onProgress) {
        onProgress(i + 1, imagePaths.length);
      }

      // Rate limiting for vision API
      if (i + 1 < imagePaths.length) {
        await sleep(500);
      }
    }

    return descriptions;
  }
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] || "image/png";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
