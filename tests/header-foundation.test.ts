import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const normalizedCss = css.replace(/\s+/g, " ");

describe("header foundation", () => {
  it("uses one surface for the header and a transparent command form", () => {
    expect(normalizedCss).toMatch(/--header-surface:\s*var\(--surface\);/);
    expect(normalizedCss).toMatch(/\.search-region\s*\{[^}]*background:\s*var\(--header-surface\);/);
    expect(normalizedCss).toMatch(/\.header-command-row\s*\{[^}]*background:\s*var\(--header-surface\);/);
    expect(normalizedCss).toMatch(/\.header-command-form\s*\{[^}]*background:\s*transparent;/);
  });

  it("uses underline only for an expanded non-busy header tool", () => {
    expect(normalizedCss).toMatch(/\.header-icon-button\[aria-expanded="true"\]:not\(\[aria-busy="true"\]\)::after\s*\{/);
    expect(normalizedCss).toMatch(/\.header-icon-button:focus-visible\s*\{[^}]*background:\s*var\(--focus-fill\);/);
    expect(normalizedCss).not.toMatch(/\.icon-button:focus-visible::after\s*\{/);
  });

  it("keeps desktop and mobile command rows aligned with their header inset", () => {
    expect(normalizedCss).toMatch(/\.workbench\s*\{[^}]*width:\s*100%;/);
    expect(normalizedCss).toMatch(/\.command-field\.header-command-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--header-command-action-width\);/);
    expect(normalizedCss).toMatch(/\.header-primary\s*\{[^}]*padding:\s*9px 16px;/);
    expect(normalizedCss).toMatch(/\.header-command-row\s*\{[^}]*padding:\s*8px 16px;/);
    expect(normalizedCss).toMatch(/@media \(max-width: 620px\)[\s\S]*\.header-primary\s*\{[^}]*padding-inline:\s*10px;/);
    expect(normalizedCss).toMatch(/@media \(max-width: 620px\)[\s\S]*\.header-command-row\s*\{[^}]*padding-inline:\s*10px;/);
  });
});
