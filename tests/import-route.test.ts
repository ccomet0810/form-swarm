import { describe, expect, it } from "vitest";
import { POST } from "../app/api/forms/import/route";

describe("form import request boundary", () => {
  it("rejects oversized chunked JSON before attempting an import", async () => {
    const request = new Request("https://example.test/api/forms/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://docs.google.com/forms/d/e/example/viewform",
        padding: "x".repeat(5_000),
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_TOO_LARGE" },
    });
  });
});
