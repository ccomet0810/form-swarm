import { fetchGoogleFormPage } from "../adapters/google-forms/fetcher";
import { parseGoogleFormHtml } from "../adapters/google-forms/parser";

export async function importGoogleForm(url: string) {
  const page = await fetchGoogleFormPage(url);
  return parseGoogleFormHtml({
    ...page,
    fetchedAt: new Date().toISOString(),
  });
}
