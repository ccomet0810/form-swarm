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

  it("shares the same command input between hero and header variants", () => {
    const hero = renderToStaticMarkup(createElement(UrlImportForm, { ...shared, variant: "hero" }));
    const command = renderToStaticMarkup(createElement(UrlImportForm, { ...shared, variant: "command" }));

    expect(hero).toContain('class="import-form joined-control initial-import-form"');
    expect(command).toContain('class="import-form joined-control header-command-form"');
    expect(hero).toContain('class="control control--input control--command"');
    expect(command).toContain('class="control control--input control--command"');
    expect(hero).toContain("<span>검색</span>");
    expect(command).toContain(">search</span>");
    expect(command).not.toContain("<span>검색</span>");
  });
});
