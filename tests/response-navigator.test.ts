import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResponseNavigator, resolveNavigatorIndex } from "../app/components/response-navigator";

describe("response navigator", () => {
  it("uses compact icon actions while preserving explicit accessible labels", () => {
    const markup = renderToStaticMarkup(createElement(ResponseNavigator, {
      label: "문항",
      index: 1,
      total: 7,
      onChange: () => undefined,
    }));

    expect(markup).toContain('aria-label="문항 이동"');
    expect(markup).toContain('aria-label="이전 문항"');
    expect(markup).toContain('aria-label="다음 문항"');
    expect(markup).toContain('>chevron_left</span>');
    expect(markup).toContain('>chevron_right</span>');
    expect(markup).toContain('value="2"');
    expect(markup).not.toContain('>이전</button>');
    expect(markup).not.toContain('>다음</button>');
  });

  it("commits only whole page numbers and clamps them to the available range", () => {
    expect(resolveNavigatorIndex("", 10, 4)).toBe(4);
    expect(resolveNavigatorIndex("2.5", 10, 4)).toBe(4);
    expect(resolveNavigatorIndex("0", 10, 4)).toBe(0);
    expect(resolveNavigatorIndex("99", 10, 4)).toBe(9);
    expect(resolveNavigatorIndex("7", 10, 4)).toBe(6);
  });
});
