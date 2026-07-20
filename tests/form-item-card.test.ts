import { readFileSync } from "node:fs";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormItemCard, FormItemCopy } from "../app/components/form-item-card";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const normalizedCss = css.replace(/\s+/g, " ");

describe("form item card", () => {
  it("uses one padded body followed by a full-width information row", () => {
    const markup = renderToStaticMarkup(createElement(
      FormItemCard,
      {
        id: "item-image-1",
        information: createElement(
          Fragment,
          null,
          createElement("dt", null, "FormItem.kind"),
          createElement("dd", null, "image"),
        ),
      },
      createElement("img", { src: "/image.png", alt: "테스트 이미지" }),
    ));

    expect(markup).toContain('class="content-item"');
    expect(markup).toContain('class="content-item-body"');
    expect(markup).toContain('class="info-details info-details--card-row"');
    expect(markup.indexOf("content-item-body")).toBeLessThan(markup.indexOf("info-details--card-row"));
  });

  it("groups headings and descriptions separately from media spacing", () => {
    const markup = renderToStaticMarkup(createElement(FormItemCopy, {
      title: "동영상 제목",
      description: "동영상 설명",
    }));

    expect(markup).toContain('class="content-item-copy"');
    expect(markup).toContain("<h3>동영상 제목</h3>");
    expect(markup).toContain("<p>동영상 설명</p>");
  });

  it("keeps the card shell, information divider, and media on one shared surface", () => {
    expect(normalizedCss).toMatch(/\.content-item\s*\{[^}]*padding:\s*0;/);
    expect(normalizedCss).toMatch(/\.content-item-body\s*\{[^}]*padding:\s*var\(--card-padding\);/);
    expect(normalizedCss).toMatch(/\.info-details--card-row\s*\{[^}]*margin-top:\s*0;/);
    expect(normalizedCss).toMatch(/\.content-item-body > \.media-image\s*\{[^}]*margin-top:\s*0;/);
    expect(normalizedCss).toMatch(/\.content-item-body > \.media-fallback\s*\{[^}]*margin-top:\s*0;/);
    expect(normalizedCss).toMatch(/\.media-image\s*\{(?![^}]*border:)[^}]*object-position:\s*left center;/);
  });
});
