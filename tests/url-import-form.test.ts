import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UrlImportForm } from "../app/components/url-import-form";

describe("URL import form", () => {
  const shared = {
    value: "",
    analyzing: false,
    disabled: false,
    onValueChange: () => undefined,
    onSubmit: () => undefined,
  };

  it("uses one icon-only header command form", () => {
    const markup = renderToStaticMarkup(createElement(UrlImportForm, shared));

    expect(markup).toContain('class="import-form command-field header-command-form"');
    expect(markup).toContain('class="control field-line control--text control--input control--command"');
    expect(markup).toContain('aria-label="Google Forms 검색"');
    expect(markup).toContain(">search</span>");
    expect(markup).not.toContain("<span>검색</span>");
    expect(markup).not.toContain("initial-import-form");
  });
});
