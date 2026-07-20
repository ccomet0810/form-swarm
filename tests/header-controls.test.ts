import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeaderCommandButton, HeaderToolButton } from "../app/components/header-controls";

describe("header controls", () => {
  it("renders toolbar actions as accessible icon-only buttons", () => {
    const markup = renderToStaticMarkup(createElement(HeaderToolButton, {
      label: "실제 제출",
      title: "실제 제출",
      symbol: "send",
      onClick: () => undefined,
    }));

    expect(markup).toContain('class="header-icon-button icon-button icon-button--plain"');
    expect(markup).toContain('aria-label="실제 제출"');
    expect(markup).toContain('title="실제 제출"');
    expect(markup).toContain('>send</span>');
    expect(markup).not.toContain('>실제 제출</');
  });

  it("keeps disclosure identity separate from busy state", () => {
    const markup = renderToStaticMarkup(createElement(HeaderToolButton, {
      label: "응답 생성 설정",
      title: "응답 생성 설정",
      symbol: "auto_awesome",
      controls: "header-generation-panel",
      expanded: true,
      busy: true,
      disabled: true,
      onClick: () => undefined,
    }));

    expect(markup).toContain('aria-controls="header-generation-panel"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
  });

  it("keeps command actions icon-only and exposes their disabled state", () => {
    const markup = renderToStaticMarkup(createElement(HeaderCommandButton, {
      label: "응답 생성",
      symbol: "auto_awesome",
      disabled: true,
    }));

    expect(markup).toContain('class="header-command-button icon-button icon-button--joined"');
    expect(markup).toContain('aria-label="응답 생성"');
    expect(markup).toContain("disabled");
    expect(markup).toContain('>auto_awesome</span>');
    expect(markup).not.toContain('>응답 생성</');
  });
});
