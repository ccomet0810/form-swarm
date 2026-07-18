import {
  fetchGoogleFormsImage,
  GoogleFormsImageProxyError,
} from "../../../../lib/adapters/google-forms/image-proxy";

const SUCCESS_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400";

function errorResponse(error: GoogleFormsImageProxyError): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    {
      status: error.status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    const requestUrl = new URL(request.url);
    const sourceUrl = requestUrl.searchParams.get("url") ?? "";
    const image = await fetchGoogleFormsImage(sourceUrl);

    return new Response(image.bytes, {
      status: 200,
      headers: {
        "cache-control": SUCCESS_CACHE_CONTROL,
        "content-length": String(image.bytes.byteLength),
        "content-type": image.contentType,
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof GoogleFormsImageProxyError) {
      return errorResponse(error);
    }

    console.error("Unexpected Google Forms image proxy failure", error);
    return errorResponse(
      new GoogleFormsImageProxyError(
        "Google Forms 이미지를 처리하는 중 문제가 발생했습니다.",
        "IMAGE_FETCH_FAILED",
        500,
      ),
    );
  }
}
