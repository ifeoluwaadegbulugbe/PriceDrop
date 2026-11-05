/**
 * LLM wrapper. The LLM can only return text. It has no tools, and nothing it returns triggers an action.
 * Free-tier content may be used by Google, so callers send no personal data.
 */
export type LlmRequest = { system: string; user: string; json: boolean };
export interface LlmProvider {
  generate(req: LlmRequest): Promise<string>;
}
/** Returns null on any failure, quota or disabled state. Callers then use deterministic code. */
export type LlmCaller = (req: LlmRequest) => Promise<string | null>;

export const LLM_TIMEOUT_MS = 8000;

export function createGeminiProvider(apiKey: string, model: string): LlmProvider {
  return {
    async generate(req) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 400,
            ...(req.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });
      if (!res.ok) throw new Error(`gemini http ${res.status}`);
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text.trim()) throw new Error("gemini empty response");
      return text;
    },
  };
}

// Control, zero-width, bidi and line-separator characters. Written as escapes so the source stays plain ASCII.
const INVISIBLE = new RegExp("[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]", "g");

/** Strip control characters and cap length. Applied to every untrusted string before a prompt. */
export function sanitizeUntrusted(text: string, max = 120): string {
  return text
    .replace(INVISIBLE, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Remove obvious personal data before text leaves for a free-tier model. */
export function scrubPersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]");
}
