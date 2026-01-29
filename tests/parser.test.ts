import { describe, it, expect } from "vitest";
import { parseMarkdownContent } from "../src/core/parser.js";

describe("parseMarkdownContent", () => {
  it("should parse frontmatter and extract title", () => {
    const content = `---
marp: true
theme: default
title: Test Presentation
---

# First Slide

Content here
`;

    const result = parseMarkdownContent(content, "test.md");

    expect(result.title).toBe("Test Presentation");
    expect(result.frontmatter.marp).toBe(true);
    expect(result.frontmatter.theme).toBe("default");
  });

  it("should split content into slides", () => {
    const content = `---
marp: true
---

# Slide 1

First slide content

---

# Slide 2

Second slide content

---

# Slide 3

Third slide content
`;

    const result = parseMarkdownContent(content, "test.md");

    expect(result.slides).toHaveLength(3);
    expect(result.slides[0].heading).toBe("Slide 1");
    expect(result.slides[1].heading).toBe("Slide 2");
    expect(result.slides[2].heading).toBe("Slide 3");
  });

  it("should extract speaker notes", () => {
    const content = `---
marp: true
---

# Slide with Notes

Some content

<!-- note: This is a speaker note -->
`;

    const result = parseMarkdownContent(content, "test.md");

    expect(result.slides[0].speakerNotes).toBe("This is a speaker note");
  });

  it("should extract image paths", () => {
    const content = `---
marp: true
---

# Slide with Images

![Alt text](./images/photo.png)

<img src="./diagram.jpg" alt="Diagram">
`;

    const result = parseMarkdownContent(content, "test.md");

    expect(result.slides[0].images).toContain("./images/photo.png");
    expect(result.slides[0].images).toContain("./diagram.jpg");
  });

  it("should not include external URLs as images", () => {
    const content = `---
marp: true
---

# External Images

![External](https://example.com/image.png)
![Local](./local.png)
`;

    const result = parseMarkdownContent(content, "test.md");

    expect(result.slides[0].images).not.toContain("https://example.com/image.png");
    expect(result.slides[0].images).toContain("./local.png");
  });

  it("should extract text content without markdown syntax", () => {
    const content = `---
marp: true
---

# Heading

- Bullet point 1
- Bullet point 2

**Bold text** and *italic text*

\`\`\`javascript
const code = "block";
\`\`\`
`;

    const result = parseMarkdownContent(content, "test.md");

    expect(result.slides[0].textOnly).toContain("Heading");
    expect(result.slides[0].textOnly).toContain("Bullet point 1");
    expect(result.slides[0].textOnly).not.toContain("```");
    expect(result.slides[0].textOnly).not.toContain("**");
  });

  it("should handle slides without headings", () => {
    const content = `---
marp: true
---

Just some content without a heading

---

# With Heading

Content
`;

    const result = parseMarkdownContent(content, "test.md");

    expect(result.slides[0].heading).toBeNull();
    expect(result.slides[1].heading).toBe("With Heading");
  });

  it("should use first slide heading as title when no frontmatter title", () => {
    const content = `---
marp: true
---

# My Presentation Title

Content
`;

    const result = parseMarkdownContent(content, "test.md");

    expect(result.title).toBe("My Presentation Title");
  });

  it("should assign correct slide indices", () => {
    const content = `---
marp: true
---

# Slide 0

---

# Slide 1

---

# Slide 2
`;

    const result = parseMarkdownContent(content, "test.md");

    expect(result.slides[0].index).toBe(0);
    expect(result.slides[1].index).toBe(1);
    expect(result.slides[2].index).toBe(2);
  });
});
