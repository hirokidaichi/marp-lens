import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs";
import path from "node:path";

const EMBEDDING_MODEL = "text-embedding-004";
const VISION_MODEL = "gemini-2.0-flash";

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
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i++) {
      const embedding = await this.embed(texts[i]);
      results.push(embedding);

      if (onProgress) {
        onProgress(i + 1, texts.length);
      }

      // Rate limiting between requests
      if (i + 1 < texts.length) {
        await sleep(100);
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
