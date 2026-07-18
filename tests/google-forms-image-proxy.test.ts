import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/forms/image/route";
import { GOOGLE_FORMS_IMAGE_MAX_BYTES } from "../lib/adapters/google-forms/image-proxy";

const VALID_IMAGE_URL =
  "https://docs.google.com/forms-images-rt/example=w1080";

function proxyRequest(sourceUrl: string): Request {
  return new Request(
    `https://example.test/api/forms/image?url=${encodeURIComponent(sourceUrl)}`,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Forms image proxy", () => {
  it.each([
    "http://docs.google.com/forms-images-rt/example=w1080",
    "https://evil.example/forms-images-rt/example=w1080",
    "https://user@docs.google.com/forms-images-rt/example=w1080",
    "https://docs.google.com:444/forms-images-rt/example=w1080",
    "https://docs.google.com/not-forms-images/example=w1080",
    "https://docs.google.com/forms-images-rt/../private",
  ])("rejects a source outside the exact allowlist: %s", async (sourceUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(proxyRequest(sourceUrl));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_IMAGE_URL" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an allowed image through the same-origin endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-type": "image/jpeg; charset=binary" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(proxyRequest(VALID_IMAGE_URL));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL(VALID_IMAGE_URL));
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      redirect: "manual",
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent": expect.stringContaining("Mozilla/5.0"),
      },
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("follows an allowed Google image redirect", async () => {
    const redirectedUrl =
      "https://lh7-rt.googleusercontent.com/rd-forms-images-rt/example=w1080";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: redirectedUrl },
        }),
      )
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(proxyRequest(VALID_IMAGE_URL));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toEqual(new URL(redirectedUrl));
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(
      fetchMock.mock.calls[1]?.[1]?.signal,
    );
  });

  it("rejects a redirect to an external host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/image.jpg" },
        }),
      ),
    );

    const response = await GET(proxyRequest(VALID_IMAGE_URL));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "IMAGE_FETCH_FAILED" },
    });
  });

  it("rejects a redirect loop", async () => {
    const redirectedUrl =
      "https://lh7-rt.googleusercontent.com/rd-forms-images-rt/example=w1080";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: redirectedUrl },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: redirectedUrl },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(proxyRequest(VALID_IMAGE_URL));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "IMAGE_FETCH_FAILED" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects SVG and other unapproved response types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<svg></svg>", {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        }),
      ),
    );

    const response = await GET(proxyRequest(VALID_IMAGE_URL));

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_IMAGE_TYPE" },
    });
  });

  it("rejects an image whose declared size exceeds 8 MiB", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(Uint8Array.from([1]), {
          status: 200,
          headers: {
            "content-length": String(GOOGLE_FORMS_IMAGE_MAX_BYTES + 1),
            "content-type": "image/png",
          },
        }),
      ),
    );

    const response = await GET(proxyRequest(VALID_IMAGE_URL));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "IMAGE_TOO_LARGE" },
    });
  });

  it("stops reading a chunked image after 8 MiB", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(GOOGLE_FORMS_IMAGE_MAX_BYTES));
        controller.enqueue(Uint8Array.from([1]));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "image/webp" },
        }),
      ),
    );

    const response = await GET(proxyRequest(VALID_IMAGE_URL));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "IMAGE_TOO_LARGE" },
    });
  });
});
