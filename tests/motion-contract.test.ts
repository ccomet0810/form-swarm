import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("motion contract", () => {
  it("contains no visual animation or smooth scrolling declarations", () => {
    expect(css).not.toMatch(/\banimation(?:-[a-z-]+)?\s*:/);
    expect(css).not.toMatch(/\btransition(?:-[a-z-]+)?\s*:/);
    expect(css).not.toMatch(/@keyframes\b/);
    expect(css).not.toMatch(/scroll-behavior\s*:/);
  });
});
