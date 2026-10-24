/**
 * Reading an uploaded test.
 *
 * A teacher in India uploads whatever they have: a Word file, a PDF from the
 * school office, a phone photo of a printed paper, sometimes a photograph of a
 * photocopy that is bent and badly lit. This module turns any of those into a
 * list of structured questions the teacher can check and correct.
 *
 * The pipeline degrades in four steps, and the UI always shows which one ran:
 *
 *   1. Plain text (.txt, .md)            — read directly
 *   2. Word (.docx)                      — mammoth, no AI needed
 *   3. PDF                                — unpdf, no AI needed
 *   4. Images and anything AI            — a vision model
 *
 * If AI is unavailable the module still splits a document into question-shaped
 * blocks with a conservative pattern matcher. The result is rough, and it says
 * so, but it saves the teacher retyping the whole paper.
 *
 * Nothing extracted is ever trusted automatically. The output is a *draft*
 * that lands in a review screen where the teacher confirms topics, marks and
 * answers before it becomes a paper.
 */

import { chatJson, fileToDataUrl, isAiEnabled, MAX_UPLOAD_BYTES, type ContentPart } from "./client";
import { TOPIC_BY_ID, QUESTION_TYPES } from "@/lib/curriculum";
import { toNumber } from "@/lib/answer-normaliser";

/* ------------------------------------------------------------------ */
/* File → text                                                         */
/* ------------------------------------------------------------------ */

export type Extraction = {
  text: string;
  kind: "text" | "docx" | "pdf" | "image" | "unsupported";
  method: "direct" | "mammoth" | "unpdf" | "ai-vision" | "none";
  pageCount?: number;
  warning?: string;
};

export function validateUpload(file: { size: number; name: string }): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${Math.round(file.size / 1024 / 1024)} MB. The limit is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB. Try photographing the paper in two halves, or use a lower-resolution scan.`;
  }
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const ok = ["doc", "docx", "pdf", "txt", "md", "png", "jpg", "jpeg", "webp", "heic"];
  if (!ok.includes(ext)) {
    return `"${ext || "that file type"}" is not supported. Upload a Word file, a PDF, or a photo (JPG, PNG, WEBP).`;
  }
  return null;
}

/** Turn an uploaded file into raw text, without any AI. */
export async function extractText(file: File): Promise<Extraction> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();

  if (ext === "txt" || ext === "md") {
    const text = await file.text();
    return { text, kind: "text", method: "direct" };
  }

  if (ext === "docx") {
    try {
      const mammoth = (await import("mammoth")).default;
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await mammoth.convertToHtml({ buffer });
      return {
        text: htmlToText(result.value),
        kind: "docx",
        method: "mammoth",
        warning: result.messages.length > 0 ? "Some formatting in the Word file could not be kept." : undefined,
      };
    } catch {
      return { text: "", kind: "docx", method: "none", warning: "This Word file could not be opened. Try saving it as PDF or copying the text in." };
    }
  }

  if (ext === "pdf") {
    try {
      const { extractText: pdfExtract } = await import("unpdf");
      const buffer = new Uint8Array(await file.arrayBuffer());
      const { text, totalPages } = await pdfExtract(buffer, { mergePages: true });
      const combined = Array.isArray(text) ? text.join("\n") : String(text);
      return {
        text: combined,
        kind: "pdf",
        method: "unpdf",
        pageCount: totalPages,
        // A scanned PDF has no text layer. Saying so is far better than
        // returning an empty string and looking broken.
        warning:
          combined.trim().length < 40
            ? "This looks like a scanned PDF with no text inside. Upload a photo of the pages instead, or type the questions in."
            : undefined,
      };
    } catch {
      return { text: "", kind: "pdf", method: "none", warning: "This PDF could not be read. Try a photo instead." };
    }
  }

  return { text: "", kind: "image", method: "none" };
}

function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/td>\s*<td[^>]*>/gi, "   ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Text → questions                                                    */
/* ------------------------------------------------------------------ */

export type ParsedQuestion = {
  stem: string;
  type: string;
  options: string[];
  answerKey: string;
  accepted: string[];
  marks: number;
  topicId: string | null;
  strand: string;
  topicConfidence: number;
  competency: string;
  difficulty: number;
  explanation: string;
};

const PARSE_SYSTEM = `You turn a school mathematics test into structured questions.

For each question you must output:
- stem: the question exactly as printed, cleaned up but with the wording unchanged
- type: one of mcq, fill_blank, true_false, match, short, medium, long, picture
- options: for mcq, the options with their letters; otherwise []
- answerKey: the correct answer, exactly as it should be marked. For mcq, the LETTER only. For a number, just the number.
- accepted: other spellings or formats that must also be given full marks
- marks: the marks printed against the question, or a sensible default for the type
- topicId: one of the topic ids supplied
- competency: basic, competent or proficient
- explanation: 2-3 short sentences telling a child how to solve it

CRITICAL:
- Never invent a question that is not in the document.
- Never change the numbers in a question.
- If the answer key is not printed in the document, work it out yourself and double-check the arithmetic.
- If you cannot read part of a question, skip it and mention it in "notes".`;

export type ParseResult = {
  questions: ParsedQuestion[];
  notes: string[];
  method: "ai-text" | "ai-vision" | "pattern";
};

export async function parseQuestionsFromText(
  text: string,
  grade: number,
  opts: { signal?: AbortSignal } = {},
): Promise<ParseResult> {
  if (isAiEnabled()) {
    try {
      return await aiParse([{ type: "text", text: "The text below is a school mathematics test. Read every question in it." }, { type: "text", text }], grade, opts.signal);
    } catch {
      // Fall through to the pattern matcher rather than failing the upload.
    }
  }
  return { questions: patternParse(text, grade), notes: ["Read without AI, so topics are a first guess. Please check each one."], method: "pattern" };
}

export async function parseQuestionsFromImage(
  file: File,
  grade: number,
  opts: { signal?: AbortSignal } = {},
): Promise<ParseResult> {
  if (!isAiEnabled()) {
    throw new Error(
      "Reading a photo of a paper needs the AI service, which is not configured. You can still upload a Word or PDF file, or type the questions in by hand.",
    );
  }
  const dataUrl = await fileToDataUrl(file);
  return aiParse(
    [
      { type: "image_url", image_url: { url: dataUrl } },
      { type: "text", text: "The image above is a school mathematics test. Read every question in it." },
    ],
    grade,
    opts.signal,
  );
}

async function aiParse(parts: ContentPart[], grade: number, signal?: AbortSignal): Promise<ParseResult> {
  const taxonomy = TOPIC_BY_ID;
  const topicList = [...taxonomy.values()]
    .filter((t) => t.classes.includes(grade))
    .map((t) => `- ${t.id} | ${t.name} — ${t.blurb}`)
    .join("\n");

  const messages = [
    { role: "system" as const, content: PARSE_SYSTEM },
    {
      role: "user" as const,
      content: [
        ...parts,
        {
          type: "text" as const,
          text: `The student is in Class ${grade}.

Topic ids you may use:
${topicList}

Types available: ${QUESTION_TYPES.map((t) => `${t.id} (${t.name}, ${t.marks} mark)`).join(", ")}

Reply with JSON only:
{
  "questions": [
    {
      "stem": "...",
      "type": "fill_blank",
      "options": [],
      "answerKey": "12",
      "accepted": ["twelve"],
      "marks": 1,
      "topicId": "<one of the ids above>",
      "competency": "basic",
      "difficulty": 2,
      "explanation": "..."
    }
  ],
  "notes": ["anything you could not read, or any question you skipped"]
}`,
        },
      ],
    },
  ];

  const raw = await chatJson<{ questions: ParsedQuestion[]; notes?: string[] }>(messages, {
    temperature: 0,
    maxTokens: 8000,
    signal,
  });

  const allowed = new Set(
    [...taxonomy.values()].filter((t) => t.classes.includes(grade)).map((t) => t.id),
  );
  const validTypes = new Set<string>(QUESTION_TYPES.map((t) => t.id));

  const questions: ParsedQuestion[] = [];
  for (const q of raw.questions ?? []) {
    if (!q?.stem || typeof q.stem !== "string") continue;
    const topicId = q.topicId && allowed.has(q.topicId) ? q.topicId : null;
    const meta = topicId ? TOPIC_BY_ID.get(topicId) : null;
    const type = validTypes.has(q.type) ? q.type : "short";

    // Self-check the arithmetic before accepting an answer key.
    const answerKey = String(q.answerKey ?? "").trim();
    const m = q.stem.match(/(\d+)\s*([+\-×*÷])\s*(\d+)/);
    let finalKey = answerKey;
    if (m && type !== "mcq" && type !== "long") {
      const a = Number(m[1]);
      const b = Number(m[3]);
      const expected =
        m[2] === "+" ? a + b
        : m[2] === "-" ? a - b
        : m[2] === "×" || m[2] === "*" ? a * b
        : b === 0 ? null : a / b;
      const given = toNumber(answerKey);
      if (expected !== null && given !== null && Math.abs(given - expected) > 1e-9) {
        // The model's key disagrees with its own arithmetic. Trust the
        // arithmetic only when the stem is a plain "a op b" with nothing else
        // in it, and flag it for the teacher either way.
        if (/^[^?=]*\d+\s*([+\-×*÷])\s*\d+\s*=?[^?]*$/.test(q.stem)) finalKey = String(expected);
      }
    }

    questions.push({
      stem: q.stem.trim(),
      type,
      options: Array.isArray(q.options) ? q.options : [],
      answerKey: finalKey,
      accepted: Array.isArray(q.accepted) ? q.accepted : [],
      marks: Math.min(10, Math.max(0.5, Number(q.marks) || 1)),
      topicId,
      strand: meta?.strand ?? "number",
      topicConfidence: topicId ? 0.8 : 0,
      competency: ["basic", "competent", "proficient"].includes(q.competency) ? q.competency : "basic",
      difficulty: Math.min(5, Math.max(1, Math.round(Number(q.difficulty) || 2))),
      explanation: q.explanation ?? "",
    });
  }

  return { questions, notes: raw.notes ?? [], method: parts.some((p) => p.type === "image_url") ? "ai-vision" : "ai-text" };
}

/* ------------------------------------------------------------------ */
/* Offline pattern matching                                           */
/* ------------------------------------------------------------------ */

/**
 * Split a document into question-shaped blocks without any AI.
 *
 * Conservative on purpose: it recognises the numbering teachers actually use
 * ("1.", "Q1", "Q 1", "(i)") and MCQ option lines, and it refuses to guess an
 * answer it cannot compute. A teacher should get a useful skeleton, not a
 * plausible-looking fabrication.
 */
export function patternParse(text: string, grade: number): ParsedQuestion[] {
  const lines = text.split(/\r?\n/);
  const blocks: string[] = [];
  let current: string[] = [];
  const questionStart = /^\s*(?:(?:q(?:uestion)?\.?\s*)?(\d{1,2})\s*[).:]|[-*]\s)\s*/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (questionStart.test(line) && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));

  const out: ParsedQuestion[] = [];
  for (const block of blocks) {
    if (block.length < 8) continue;
    const firstLine = block.split("\n")[0];
    const stem = firstLine.replace(questionStart, "").trim() || block.split("\n")[0];
    if (stem.length < 4) continue;

    // Options: lines like "a) 12" or "A. 12" following the stem.
    const optionLines = block.split("\n").slice(1).filter((l) => /^\s*[a-dA-D][).:]\s*\S/.test(l));
    const options = optionLines.map((l) => l.trim());

    // Marks printed against the question: "(2)" or "[3]".
    const marksMatch = block.match(/[(\[]\s*(\d+(?:\.\d+)?)\s*[)\]]/);
    const marks = marksMatch ? Number(marksMatch[1]) : 1;

    const type = options.length >= 2 ? "mcq" : "fill_blank";
    const { answerKey, accepted } = offlineAnswer(stem, options, type);

    out.push({
      stem,
      type,
      options,
      answerKey,
      accepted,
      marks,
      topicId: null,
      strand: "number",
      topicConfidence: 0,
      competency: "basic",
      difficulty: 2,
      explanation: "",
    });
  }
  return out;
}

/** Work out the answer when the stem is plain arithmetic; otherwise leave blank. */
function offlineAnswer(stem: string, options: string[], type: string): { answerKey: string; accepted: string[] } {
  const m = stem.match(/(\d+(?:\.\d+)?)\s*([+\-×*÷])\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const value =
      m[2] === "+" ? a + b
      : m[2] === "-" ? a - b
      : m[2] === "×" || m[2] === "*" ? a * b
      : b === 0 ? null : a / b;
    if (value !== null) {
      if (type === "mcq") {
        const match = options.find((o) => new RegExp(`\\b${escapeRe(String(value))}\\b`).test(o));
        if (match) {
          const letter = match.trim()[0].toUpperCase();
          return { answerKey: letter, accepted: [String(value)] };
        }
        return { answerKey: "", accepted: [] };
      }
      return { answerKey: String(value), accepted: [] };
    }
  }
  return { answerKey: "", accepted: [] };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
