import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ControlInput, ControlSelect, IconButton } from "../app/components/form-controls";

describe("form control system", () => {
  it("applies semantic control variants without replacing native controls", () => {
    const input = renderToStaticMarkup(createElement(ControlInput, {
      variant: "command",
      type: "url",
      placeholder: "Google Forms 링크",
    }));
    const select = renderToStaticMarkup(createElement(
      ControlSelect,
      { "aria-label": "문항 선택" },
      createElement("option", { value: "one" }, "첫 문항"),
    ));

    expect(input).toContain('class="control control--input control--command"');
    expect(input).toContain('type="url"');
    expect(select).toContain('class="select-control select-control--editor"');
    expect(select).toContain('class="control control--select control--editor"');
    expect(select).toContain('aria-label="문항 선택"');
    expect(select).toContain('class="material-symbol select-control-icon"');
    expect(select).toContain('aria-hidden="true"');
    expect(select).toContain('>expand_more</span>');
    expect(select.match(/<select\b/g)).toHaveLength(1);
    expect(select.match(/aria-label="문항 선택"/g)).toHaveLength(1);
  });

  it("renders icon actions with a visible title and accessible name", () => {
    const markup = renderToStaticMarkup(createElement(IconButton, {
      label: "다음 응답",
      symbol: "chevron_right",
      variant: "outlined",
    }));

    expect(markup).toContain('class="icon-button icon-button--outlined"');
    expect(markup).toContain('aria-label="다음 응답"');
    expect(markup).toContain('title="다음 응답"');
    expect(markup).toContain('>chevron_right</span>');
  });
});
