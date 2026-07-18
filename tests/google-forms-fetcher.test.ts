import { afterEach, describe, expect, it, vi } from "vitest";
import { FormImportError } from "../lib/adapters/google-forms/errors";
import { fetchGoogleFormPage } from "../lib/adapters/google-forms/fetcher";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Forms bounded fetcher", () => {
  it("reuses one deadline across redirects and never forwards query parameters", async () => {
    const signals: AbortSignal[] = [];
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      urls.push(input.toString());
      signals.push(init?.signal as AbortSignal);
      if (urls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://docs.google.com/forms/d/e/example/viewform?entry.123=sensitive",
          },
        });
      }
      return new Response("<html>fixture</html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = await fetchGoogleFormPage(
      "https://forms.gle/example?entry.123=sensitive",
    );

    expect(urls).toHaveLength(2);
    expect(urls.every((url) => !url.includes("entry.123"))).toBe(true);
    expect(signals[0]).toBe(signals[1]);
    expect(page.canonicalUrl).toBe(
      "https://docs.google.com/forms/d/e/example/viewform",
    );
  });

  it("cancels response bodies when rejecting an early response", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("not html"));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(body, { headers: { "content-type": "application/json" } }),
      ),
    );

    await expect(
      fetchGoogleFormPage("https://docs.google.com/forms/d/e/example/viewform"),
    ).rejects.toBeInstanceOf(FormImportError);
    expect(cancelled).toBe(true);
  });
});
