/**
 * AI client.
 *
 * Deliberately thin and dependency-free: it speaks the OpenAI chat-completions
 * protocol, so it works against OpenAI, DeepSeek, Groq, Together, an
 * on-premise vLLM, or a school gateway, by changing one base URL.
 *
 * The single most important property of this module is that **the app is fully
 * functional without it**. Every caller has a non-AI path, and `isAiEnabled()`
 * is checked before the upload screen ever promises anything to a teacher. A
 * school with no budget, no internet, or a strict no-data-leaves-the-campus
 * policy can still run the whole product.
 */

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type AiSettings = {
  apiKey: string;
  baseUrl: string;
  visionModel: string;
  textModel: string;
};

export function aiSettings(): AiSettings {
  return {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    baseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    visionModel: process.env.AI_VISION_MODEL ?? "gpt-4o-mini",
    textModel: process.env.AI_TEXT_MODEL ?? "gpt-4o-mini",
  };
}

/** True only when a key is present and uploads are not explicitly blocked. */
export function isAiEnabled(): boolean {
  const { apiKey } = aiSettings();
  if (!apiKey) return false;
  if (process.env.AI_ALLOW_UPLOADS === "0") return false;
  return true;
}

/** Why AI is unavailable, so the UI can say something useful instead of failing. */
export function aiDisabledReason(): string | null {
  if (isAiEnabled()) return null;
  if (process.env.AI_ALLOW_UPLOADS === "0") {
    return "AI is switched off for this install (AI_ALLOW_UPLOADS=0). Nothing leaves this machine.";
  }
  if (!process.env.OPENAI_API_KEY) {
    return "No AI key configured. You can still type questions in by hand or paste text — everything else works.";
  }
  return null;
}

export class AiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AiError";
  }
}

/**
 * One chat completion. Throws AiError with a readable message on failure —
 * callers are expected to catch and fall back, never to crash the request.
 */
export async function chat(
  messages: AiMessage[],
  opts: { model?: string; temperature?: number; maxTokens?: number; json?: boolean; signal?: AbortSignal } = {},
): Promise<string> {
  const cfg = aiSettings();
  if (!cfg.apiKey) throw new AiError("No AI key configured");

  const body: Record<string, unknown> = {
    model: opts.model ?? cfg.textModel,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 4000,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    throw new AiError(
      `Could not reach the AI service at ${cfg.baseUrl}. Check the network or the base URL.`,
      0,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AiError(`AI service returned ${res.status}. ${detail.slice(0, 300)}`, res.status);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new AiError("AI service returned an empty response");
  return text;
}

/**
 * Ask for JSON and get JSON back.
 *
 * Models wrap JSON in prose and fences far more often than the API docs
 * suggest, so the extraction is deliberately forgiving: strip fences, take the
 * outermost braces, and only then parse. Anything still unparseable is an
 * error the caller must handle — never a silent empty object.
 */
export async function chatJson<T>(
  messages: AiMessage[],
  opts: { model?: string; temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const raw = await chat(messages, { ...opts, json: true });
  const cleaned = extractJson(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AiError(`AI did not return valid JSON. First 200 characters: ${raw.slice(0, 200)}`);
  }
}

export function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const arrStart = s.indexOf("[");
  const useArray = arrStart !== -1 && (start === -1 || arrStart < start);
  const open = useArray ? arrStart : start;
  const closeChar = useArray ? "]" : "}";
  if (open === -1) return s;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === (useArray ? "[" : "{")) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return s.slice(open, i + 1);
    }
  }
  return s.slice(open);
}

/* ------------------------------------------------------------------ */
/* File handling                                                       */
/* ------------------------------------------------------------------ */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB — a phone photo of a full paper

export const ACCEPTED_UPLOADS =
  ".doc,.docx,.pdf,.png,.jpg,.jpeg,.webp,.heic,.txt,.md,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Convert a File to a data URL for a vision model. */
export async function fileToDataUrl(file: File | Blob): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file instanceof File ? file.name : "";
  const mime = file.type || guessMime(name);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    pdf: "application/pdf",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", heic: "image/heic", txt: "text/plain", md: "text/markdown",
  };
  return map[ext] ?? "application/octet-stream";
}
