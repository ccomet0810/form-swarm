import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveHeaderPanel, Workbench } from "../app/components/workbench";

function openingTagContaining(markup: string, value: string): string {
  const valueIndex = markup.indexOf(value);
  if (valueIndex < 0) return "";
  const start = markup.lastIndexOf("<", valueIndex);
  const end = markup.indexOf(">", valueIndex);
  return markup.slice(start, end + 1);
}

describe("workbench initial state", () => {
  it("keeps the URL panel open until a form exists", () => {
    expect(resolveHeaderPanel(false, null)).toBe("url");
    expect(resolveHeaderPanel(false, "generate")).toBe("url");
    expect(resolveHeaderPanel(true, null)).toBeNull();
    expect(resolveHeaderPanel(true, "generate")).toBe("generate");
  });

  it("renders the real header with only URL entry available", () => {
    const markup = renderToStaticMarkup(createElement(Workbench));

    expect(markup).toContain('<main class="workbench has-header-panel">');
    expect(markup).toContain("<h1>FORM SWARM</h1>");
    expect(markup).toContain('id="header-url-panel"');
    expect(openingTagContaining(markup, 'id="form-url"')).not.toContain("disabled");
    expect(openingTagContaining(markup, 'aria-label="Google Forms 검색"')).not.toContain("disabled");
    expect(openingTagContaining(markup, 'aria-label="Google Forms 링크 입력"')).not.toContain("disabled");
    expect(openingTagContaining(markup, 'aria-label="응답 생성 설정"')).toContain("disabled");
    expect(openingTagContaining(markup, 'aria-label="실제 제출"')).toContain("disabled");
    expect(openingTagContaining(markup, 'id="workspace-tab-questions"')).toContain("disabled");
    expect(openingTagContaining(markup, 'class="workspace-tabs"')).toContain('aria-hidden="true"');
    expect(openingTagContaining(markup, 'class="workspace-tabs"')).toContain("inert");
    expect(markup).not.toContain("brand-wordmark");
    expect(markup).not.toContain("initial-import-form");
  });
});
