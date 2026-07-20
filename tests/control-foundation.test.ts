import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const normalizedCss = css.replace(/\s+/g, " ");

describe("control foundation", () => {
  it("shares one left-aligned underline surface between live and preview text fields", () => {
    expect(normalizedCss).toMatch(/\.field-line\s*\{[^}]*padding-inline:\s*0;[^}]*border:\s*0;[^}]*box-shadow:\s*inset 0 -1px var\(--line-soft\);/);
    expect(normalizedCss).toMatch(/\.control--text:focus\s*\{[^}]*box-shadow:\s*inset 0 calc\(-1 \* var\(--border-strong\)\) var\(--text\);/);
  });

  it("keeps invalid text fields on the same underline surface", () => {
    expect(normalizedCss).toMatch(/\.control--text\[aria-invalid="true"\]\s*\{[^}]*box-shadow:[^}]*var\(--danger\);/);
  });

  it("uses a stable light frame and fixed non-interactive slot for selects", () => {
    expect(normalizedCss).toMatch(/\.select-control \.control--select\s*\{[^}]*padding:[^}]*var\(--control-icon-slot\)[^}]*border:\s*1px solid var\(--line-soft\);[^}]*appearance:\s*none;/);
    expect(normalizedCss).toMatch(/\.select-control-icon\s*\{[^}]*inset-inline-end:\s*calc\([^;]+\);[^}]*pointer-events:\s*none;/);
  });

  it("treats compound percent and header command fields as one underline", () => {
    expect(normalizedCss).toMatch(/\.percent-input\s*\{[^}]*box-shadow:\s*inset 0 -1px var\(--line-soft\);/);
    expect(normalizedCss).toMatch(/\.percent-input \.control\s*\{[^}]*box-shadow:\s*none;/);
    expect(normalizedCss).toMatch(/\.header-command-form\s*\{[^}]*box-shadow:\s*inset 0 -1px var\(--line-soft\);/);
    expect(normalizedCss).toMatch(/\.header-command-form \.control--command\s*\{[^}]*box-shadow:\s*none;/);
  });
});
