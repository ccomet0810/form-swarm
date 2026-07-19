import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResponseSummaryCard } from "../app/components/response-summary";
import type { FormQuestion } from "../lib/domain/form-schema";
import type { QuestionSummary } from "../lib/summary/aggregate";

const question: FormQuestion = {
  id: "question-1",
  itemId: "1",
  entryIds: ["10"],
  sectionId: "section-1",
  index: 0,
  title: "테스트 문항",
  description: null,
  type: "paragraph",
  required: false,
  options: [],
  rawType: 1,
};

function renderSummary(summary: QuestionSummary): string {
  return renderToStaticMarkup(
    createElement(ResponseSummaryCard, { question, summary }),
  );
}

describe("response summary card", () => {
  it("renders a provided summary without requiring the response array", () => {
    const html = renderSummary({
      kind: "text_list",
      responseCount: 2,
      values: ["같은 응답", "같은 응답"],
    });

    expect(html).toContain("테스트 문항");
    expect(html).toContain("응답 2개");
    expect(html.match(/같은 응답/g)).toHaveLength(2);
  });

  it("renders a count axis with nice integer ticks for vertical bars", () => {
    const html = renderSummary({
      kind: "vertical_bars",
      responseCount: 8,
      values: [
        { label: "1", count: 7, percentage: 87.5 },
        { label: "2", count: 1, percentage: 12.5 },
      ],
    });

    expect(html).toContain('class="chart-y-axis"');
    expect(html).toContain("--chart-tick-count:4");
    expect(html).toContain("--chart-category-count:2");
    expect(html).toContain("--chart-value:87.5%");
  });

  it("shows a frequency pill for every temporal row, including count one", () => {
    const html = renderSummary({
      kind: "temporal",
      responseCount: 3,
      values: [
        { label: "2026-07-01", count: 2, percentage: 66.7 },
        { label: "2026-07-02", count: 1, percentage: 33.3 },
      ],
    });

    expect(html).toContain('<b title="66.7%">2</b>');
    expect(html).toContain('<b title="33.3%">1</b>');
    expect(html).not.toContain("opacity:");
  });

  it("uses a dedicated empty state instead of drawing an empty chart", () => {
    const html = renderSummary({
      kind: "pie",
      responseCount: 0,
      values: [{ label: "선택지", count: 0, percentage: 0 }],
    });

    expect(html).toContain("응답이 없습니다.");
    expect(html).not.toContain('class="pie-chart"');
  });
});
