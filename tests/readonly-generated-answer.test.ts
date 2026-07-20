import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadonlyGeneratedAnswer } from "../app/components/workbench";
import type { FormQuestion } from "../lib/domain/form-schema";

function question(type: FormQuestion["type"]): FormQuestion {
  return {
    id: `question-${type}`,
    itemId: "1",
    entryIds: ["10"],
    sectionId: "section-1",
    index: 0,
    title: "테스트 문항",
    description: null,
    type,
    required: false,
    options: [],
    rawType: 0,
  };
}

describe("readonly generated answer", () => {
  it.each([
    ["short_text", undefined],
    ["paragraph", "  \n  "],
  ] as const)("keeps the %s answer field when its value is empty", (type, answer) => {
    const markup = renderToStaticMarkup(createElement(ReadonlyGeneratedAnswer, {
      question: question(type),
      answer,
    }));

    expect(markup).toContain(`readonly-text-answer--${type}`);
    expect(markup).toContain('data-empty=""');
    expect(markup).toContain(">응답 없음</div>");
    expect(markup).not.toContain("readonly-empty-answer");
  });

  it("keeps the generic empty state for non-text answers", () => {
    const markup = renderToStaticMarkup(createElement(ReadonlyGeneratedAnswer, {
      question: question("dropdown"),
      answer: undefined,
    }));

    expect(markup).toContain('class="readonly-empty-answer"');
  });
});
