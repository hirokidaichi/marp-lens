import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import type { ParsedDocument, ParsedSlide } from "../types/index.js";

export function parseMarkdownFile(filePath: string): ParsedDocument {
  const content = fs.readFileSync(filePath, "utf-8");
  return parseMarkdownContent(content, filePath);
}

export function parseMarkdownContent(
  content: string,
  filePath: string
): ParsedDocument {
  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter: Record<string, unknown> = frontmatterMatch
    ? parseYaml(frontmatterMatch[1]) || {}
    : {};

  // Remove frontmatter from content
  const bodyContent = content.replace(/^---\n[\s\S]*?\n---\n?/, "");

  // Split into slides by --- at the start of a line
  const slideContents = bodyContent.split(/\n---\n/).filter((s) => s.trim());

  const slides: ParsedSlide[] = slideContents.map((slideContent, index) => {
    return parseSlide(slideContent, index);
  });

  // Extract title from frontmatter or first slide heading
  const title =
    (frontmatter.title as string) || slides[0]?.heading || "Untitled";

  return {
    filePath,
    frontmatter,
    title,
    slides,
  };
}

function parseSlide(content: string, index: number): ParsedSlide {
  // Extract first heading (H1 or H2)
  const headingMatch = content.match(/^#+\s+(.+)$/m);
  const heading = headingMatch ? headingMatch[1].trim() : null;

  // Extract speaker notes
  const noteMatch = content.match(/<!--\s*note:\s*([\s\S]*?)-->/i);
  const speakerNotes = noteMatch ? noteMatch[1].trim() : "";

  // Extract image paths
  const images = extractImagePaths(content);

  // Clean text for embedding
  const textOnly = extractTextContent(content);

  return {
    index,
    heading,
    content,
    textOnly,
    speakerNotes,
    images,
  };
}

function extractImagePaths(content: string): string[] {
  const imagePaths: string[] = [];

  // Match markdown image syntax: ![...](path)
  const markdownImageRegex = /!\[.*?\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownImageRegex.exec(content)) !== null) {
    const path = match[1].split(/\s+/)[0]; // Remove any attributes after path
    if (isLocalImage(path)) {
      imagePaths.push(path);
    }
  }

  // Match HTML img tags: <img src="path" ...>
  const htmlImageRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((match = htmlImageRegex.exec(content)) !== null) {
    if (isLocalImage(match[1])) {
      imagePaths.push(match[1]);
    }
  }

  return [...new Set(imagePaths)]; // Remove duplicates
}

function isLocalImage(path: string): boolean {
  // Skip URLs, data URIs, and non-image files
  if (path.startsWith("http://") || path.startsWith("https://")) return false;
  if (path.startsWith("data:")) return false;

  const ext = path.split(".").pop()?.toLowerCase();
  return ["png", "jpg", "jpeg", "gif", "webp"].includes(ext || "");
}

function extractTextContent(content: string): string {
  return (
    content
      // Remove HTML comments (including speaker notes and directives)
      .replace(/<!--[\s\S]*?-->/g, "")
      // Remove HTML tags but preserve text content
      .replace(/<[^>]+>/g, " ")
      // Remove image markdown syntax
      .replace(/!\[.*?\]\(.*?\)/g, "")
      // Remove link markdown but keep link text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, "")
      // Remove inline code
      .replace(/`[^`]+`/g, "")
      // Remove bold/italic markers but keep text
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      // Remove heading markers but keep text
      .replace(/^#+\s+/gm, "")
      // Remove bullet point markers
      .replace(/^\s*[-*+]\s+/gm, "")
      // Remove numbered list markers
      .replace(/^\s*\d+\.\s+/gm, "")
      // Remove blockquote markers
      .replace(/^>\s+/gm, "")
      // Remove horizontal rules
      .replace(/^[-*_]{3,}$/gm, "")
      // Normalize whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}
