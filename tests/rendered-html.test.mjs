import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

function openingTagContaining(markup, value) {
  const valueIndex = markup.indexOf(value);
  if (valueIndex < 0) return "";
  const start = markup.lastIndexOf("<", valueIndex);
  const end = markup.indexOf(">", valueIndex);
  return markup.slice(start, end + 1);
}

test("server-renders the minimal form analyzer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? html;
  assert.match(html, /Google Forms 링크/);
  assert.match(body, /<h1>FORM SWARM<\/h1>/);
  assert.match(body, /id="header-url-panel"/);
  assert.match(body, /header-primary has-command is-required-command/);
  assert.match(openingTagContaining(body, 'aria-label="응답 생성 설정"'), /disabled/);
  assert.match(openingTagContaining(body, 'id="workspace-tab-questions"'), /disabled/);
  assert.match(html, /og-form-swarm\.png/);
  assert.doesNotMatch(body, /brand-wordmark|initial-import-form|header-command-row|header-command-back/);
  assert.doesNotMatch(body, /FormSwarm|링크 하나로|READ-ONLY LAB/);
  assert.doesNotMatch(body, /온보딩 경험 평가|손글씨 폰트 설문|랜덤 시드/);
  assert.doesNotMatch(body, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});
