import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const normalizedCss = css.replace(/\s+/g, " ");

describe("control foundation", () => {
  it("reserves the editor frame and reveals it without changing border widths", () => {
    expect(normalizedCss).toMatch(/\.control--editor\s*\{[^}]*--control-frame-color:\s*transparent;[^}]*border:\s*1px solid var\(--control-frame-color\);[^}]*border-bottom:\s*var\(--border-strong\) solid var\(--control-underline-color\);/);
    expect(normalizedCss).toMatch(/\.control--editor:hover:not\(:disabled\),\s*\.control--editor:focus\s*\{[^}]*--control-frame-color:\s*var\(--line-soft\);/);
  });

  it("keeps invalid underlines independent from hover and focus frame state", () => {
    expect(normalizedCss).toMatch(/\.control\[aria-invalid="true"\]\s*\{[^}]*--control-underline-color:\s*var\(--danger\);/);
  });

  it("uses one fixed, non-interactive slot for select arrows", () => {
    expect(normalizedCss).toMatch(/\.select-control \.control--select\s*\{[^}]*padding-inline-end:\s*var\(--control-icon-slot\);[^}]*appearance:\s*none;/);
    expect(normalizedCss).toMatch(/\.select-control-icon\s*\{[^}]*inset-inline-end:\s*calc\([^;]+\);[^}]*pointer-events:\s*none;/);
  });

  it("treats the percent suffix as part of the same editor frame", () => {
    expect(normalizedCss).toMatch(/\.percent-input > span\s*\{[^}]*border:\s*1px solid transparent;[^}]*border-bottom:\s*var\(--border-strong\) solid var\(--text\);/);
    expect(normalizedCss).toMatch(/\.percent-input:hover > span,\s*\.percent-input:focus-within > span\s*\{[^}]*border-color:\s*var\(--line-soft\);/);
  });
});
