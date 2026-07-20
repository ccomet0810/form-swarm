import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const normalizedCss = css.replace(/\s+/g, " ");

describe("header foundation", () => {
  it("uses one surface for the header and a transparent command form", () => {
    expect(normalizedCss).toMatch(/--header-surface:\s*var\(--surface\);/);
    expect(normalizedCss).toMatch(/\.search-region\s*\{[^}]*background:\s*var\(--header-surface\);/);
    expect(normalizedCss).toMatch(/\.header-command-form\s*\{[^}]*background:\s*transparent;/);
    expect(normalizedCss).not.toContain(".header-command-row");
  });

  it("uses underline only for an expanded non-busy header tool", () => {
    expect(normalizedCss).toMatch(/\.header-icon-button\[aria-expanded="true"\]:not\(:disabled\):not\(\[aria-busy="true"\]\)::after\s*\{/);
    expect(normalizedCss).toMatch(/\.header-icon-button:focus-visible\s*\{[^}]*background:\s*var\(--focus-fill\);/);
    expect(normalizedCss).not.toMatch(/\.icon-button:focus-visible::after\s*\{/);
  });

  it("centers the desktop command slot between symmetric side tracks", () => {
    expect(normalizedCss).toMatch(/\.workbench\s*\{[^}]*width:\s*100%;/);
    expect(normalizedCss).toMatch(/--header-side-track:\s*152px;/);
    expect(normalizedCss).toMatch(/\.header-primary\s*\{[^}]*grid-template-columns:\s*minmax\(var\(--header-side-track\), 1fr\) minmax\(0, var\(--content-column\)\) minmax\(var\(--header-side-track\), 1fr\);/);
    expect(normalizedCss).toMatch(/\.header-command-slot\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*grid-column:\s*2;/);
    expect(normalizedCss).toMatch(/\.header-identity\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/);
    expect(normalizedCss).toMatch(/\.workspace-actions\s*\{[^}]*grid-column:\s*3;/);
    expect(normalizedCss).toMatch(/\.command-field\.header-command-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--header-command-action-width\);/);
    expect(normalizedCss).not.toContain("--header-panel-height");
    expect(normalizedCss).not.toContain(".workbench.has-header-panel");
  });

  it("reuses the same command slot in the narrow back-header layout", () => {
    expect(normalizedCss).toMatch(/\.search-region\s*\{[^}]*container-name:\s*app-header;[^}]*container-type:\s*inline-size;/);
    expect(normalizedCss).toMatch(/@container app-header \(max-width: 760px\)/);
    expect(normalizedCss).toMatch(/\.header-primary\.has-command\s*\{[^}]*grid-template-columns:\s*var\(--header-tool-size\) minmax\(0, 1fr\);/);
    expect(normalizedCss).toMatch(/\.header-primary\.has-command \.header-command-back\s*\{[^}]*display:\s*inline-flex;[^}]*grid-column:\s*1;/);
    expect(normalizedCss).toMatch(/\.header-primary\.has-command \.header-command-slot\s*\{[^}]*grid-column:\s*2;/);
    expect(normalizedCss).toMatch(/\.header-primary\.has-command\.is-required-command\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  });
});
