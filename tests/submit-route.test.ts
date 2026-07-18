import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/forms/submit/route";

function responderHtml(items: unknown[]): string {
  const formData: unknown[] = [];
  formData[1] = items;
  formData[8] = "Submit route fixture";
  const payload: unknown[] = [];
  payload[1] = formData;
  return `<!doctype html><html lang="ko">
    <form action="https://docs.google.com/forms/d/e/route-fixture/formResponse" method="POST">
      <input type="hidden" name="fvv" value="1">
      <input type="hidden" name="partialResponse" value="partial">
      <input type="hidden" name="pageHistory" value="0">
      <input type="hidden" name="fbzx" value="route-token">
    </form>
    <script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(payload)};</script>
  </html>`;
}

const requiredTextHtml = responderHtml([
  [1, "필수 단답", null, 0, [[101, null, 1]]],
]);

function requestWithBody(body: unknown): Request {
  return new Request("https://app.example/api/forms/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("single Google Forms response submit route", () => {
  it("refetches the public form, validates one response, and posts the server-derived action", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(requiredTextHtml, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<main>응답이 기록되었습니다.</main>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      requestWithBody({
        url: "https://docs.google.com/forms/d/e/route-fixture/viewform",
        response: {
          id: "generated-1",
          index: 0,
          answers: { "question-1": "테스트 응답" },
          // These untrusted values are deliberately wrong; the route replaces them.
          pageHistory: "999",
          visitedSectionIds: ["not-a-section"],
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://docs.google.com/forms/d/e/route-fixture/formResponse",
    );
    const postInit = fetchMock.mock.calls[1][1];
    expect(postInit?.method).toBe("POST");
    const submitted = new URLSearchParams(String(postInit?.body));
    expect([...submitted.entries()]).toMatchInlineSnapshot(`
      [
        [
          "entry.101",
          "테스트 응답",
        ],
        [
          "fvv",
          "1",
        ],
        [
          "partialResponse",
          "partial",
        ],
        [
          "pageHistory",
          "0",
        ],
        [
          "fbzx",
          "route-token",
        ],
      ]
    `);
  });

  it("does not submit a response that fails freshly fetched required-question validation", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(requiredTextHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      requestWithBody({
        url: "https://docs.google.com/forms/d/e/route-fixture/viewform",
        response: { id: "generated-1", index: 0, answers: {} },
      }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "RESPONSE_INVALID",
        issues: [{ questionId: "question-1", code: "REQUIRED_MISSING" }],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects batches and fails explicitly when the refetched form contains file upload", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
    const batchResponse = await POST(
      requestWithBody({
        url: "https://docs.google.com/forms/d/e/route-fixture/viewform",
        responses: [],
      }),
    );
    expect(batchResponse.status).toBe(400);

    const fileFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        responderHtml([[13, "파일 업로드", null, 13, [[1301, null, 1]]]]),
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    );
    vi.stubGlobal("fetch", fileFetch);
    const fileResponse = await POST(
      requestWithBody({
        url: "https://docs.google.com/forms/d/e/route-fixture/viewform",
        response: { id: "generated-1", index: 0, answers: {} },
      }),
    );
    expect(fileResponse.status).toBe(422);
    await expect(fileResponse.json()).resolves.toMatchObject({
      error: { code: "FILE_UPLOAD_UNSUPPORTED" },
    });
    expect(fileFetch).toHaveBeenCalledTimes(1);
  });
});
