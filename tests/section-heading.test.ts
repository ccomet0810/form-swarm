import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionHeading } from "../app/components/section-heading";
import type { FormSection } from "../lib/domain/form-schema";

describe("section heading", () => {
  it("keeps the section title and description without a generated number marker", () => {
    const section: FormSection = {
      id: "section-a",
      itemId: "100",
      index: 0,
      title: "A 경로",
      description: "첫 번째 분기입니다.",
      questionIds: [],
    };
    const markup = renderToStaticMarkup(createElement(SectionHeading, {
      section,
      headingId: "section-a-heading",
    }));

    expect(markup).toContain('id="section-a-heading"');
    expect(markup).toContain("A 경로");
    expect(markup).toContain("첫 번째 분기입니다.");
    expect(markup).not.toContain("section-marker");
    expect(markup).not.toContain(">01<");
  });
});
