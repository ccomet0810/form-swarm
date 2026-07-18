import { describe, expect, it } from "vitest";
import { POST as submitRoute } from "../app/api/forms/submit/route";
import { importGoogleForm } from "../lib/application/import-google-form";
import { generateResponses } from "../lib/generator/engine";
import { createDefaultRules } from "../lib/generator/rules";
import { validateGeneratedResponse } from "../lib/generator/validation";

const LIVE = process.env.LIVE_GOOGLE_FORMS_SUBMIT_TEST === "1";
const ADVANCED_FORM = "https://docs.google.com/forms/d/e/1FAIpQLSeFJy4uwdTHLefBthkJlvn2HfavCyZpQ_lG2ySa4YjHA39a-A/viewform";

describe.skipIf(!LIVE)("opt-in live Google Forms submission", () => {
  it("submits exactly one generated response to the user-provided test form", async () => {
    const form = await importGoogleForm(ADVANCED_FORM);
    const [generated] = generateResponses({
      form,
      rules: createDefaultRules(form),
      count: 1,
      seed: `opt-in-live-submit-${Date.now()}`,
    });
    expect(validateGeneratedResponse(form, generated).valid).toBe(true);

    const result = await submitRoute(new Request("http://localhost/api/forms/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: ADVANCED_FORM, response: generated }),
    }));
    const payload = await result.json() as {
      accepted?: boolean;
      error?: { code?: string; message?: string };
    };

    expect(payload.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(payload.accepted).toBe(true);
  }, 30_000);
});
