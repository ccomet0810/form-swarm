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

test("server-renders the minimal form analyzer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? html;
  assert.match(html, /Google Forms 링크/);
  assert.match(html, /분석/);
  assert.match(html, /og-form-swarm\.png/);
  assert.doesNotMatch(body, /FormSwarm|링크 하나로|READ-ONLY LAB/);
  assert.doesNotMatch(body, /온보딩 경험 평가|손글씨 폰트 설문|랜덤 시드/);
  assert.doesNotMatch(body, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});
