import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadonlyAnswerField } from "../app/components/readonly-answer-field";

describe("readonly answer field", () => {
  it("keeps the text answer surface when the response is empty", () => {
    const markup = renderToStaticMarkup(createElement(ReadonlyAnswerField, {
      kind: "short_text",
    }));

    expect(markup).toContain('class="readonly-text-answer readonly-text-answer--short_text"');
    expect(markup).toContain('data-empty=""');
    expect(markup).toContain(">응답 없음</div>");
  });

  it("renders a paragraph answer in the same component without the empty state", () => {
    const markup = renderToStaticMarkup(createElement(ReadonlyAnswerField, {
      kind: "paragraph",
      value: "작성된 장문형 응답입니다.",
    }));

    expect(markup).toContain('class="readonly-text-answer readonly-text-answer--paragraph"');
    expect(markup).not.toContain("data-empty");
    expect(markup).toContain("작성된 장문형 응답입니다.");
  });

  it("treats whitespace-only paragraph responses as empty without changing the surface", () => {
    const markup = renderToStaticMarkup(createElement(ReadonlyAnswerField, {
      kind: "paragraph",
      value: "  \n  ",
    }));

    expect(markup).toContain('class="readonly-text-answer readonly-text-answer--paragraph"');
    expect(markup).toContain('data-empty=""');
    expect(markup).toContain(">응답 없음</div>");
  });
});
