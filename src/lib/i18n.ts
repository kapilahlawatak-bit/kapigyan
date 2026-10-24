/**
 * Bilingual support.
 *
 * Most Indian schools teach mathematics in English while the home language is
 * Hindi or a regional language, and NCF-FL asks for material in the child's
 * language. So the interface is bilingual (English / हिन्दी) and generated
 * questions can be produced in both.
 *
 * This is a deliberate middle path: every navigation label, button and status
 * word is translated, because those are what a parent or a new teacher meets
 * first. Long-form teaching content stays in English, where the explanation
 * quality from the curriculum research is strongest, and the Hindi version is
 * generated alongside it for the parts that get printed and sent home.
 */

import { cookies } from "next/headers";

export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_COOKIE = "kapigyan_locale";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return value === "hi" ? "hi" : "en";
}

export async function setLocale(locale: string): Promise<Locale> {
  const next: Locale = locale === "hi" ? "hi" : "en";
  const store = await cookies();
  store.set(LOCALE_COOKIE, next, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return next;
}

type Dict = Record<string, { en: string; hi: string }>;

/** Interface strings. Anything not listed falls back to English. */
export const STRINGS: Dict = {
  dashboard: { en: "Dashboard", hi: "डैशबोर्ड" },
  tests: { en: "Tests & Papers", hi: "परीक्षाएँ" },
  createUpload: { en: "Create / Upload", hi: "बनाएँ / अपलोड करें" },
  questionBank: { en: "Question Bank", hi: "प्रश्न बैंक" },
  classes: { en: "Classes & Students", hi: "कक्षाएँ और विद्यार्थी" },
  analytics: { en: "Analytics", hi: "विश्लेषण" },
  reports: { en: "Reports", hi: "रिपोर्ट" },
  insights: { en: "Teaching Insights", hi: "शिक्षण अंतर्दृष्टि" },
  students: { en: "Students", hi: "विद्यार्थी" },
  average: { en: "Class average", hi: "औसत" },
  median: { en: "Median", hi: "माध्यिका" },
  highest: { en: "Highest", hi: "सर्वाधिक" },
  lowest: { en: "Lowest", hi: "सर्व न्यूनतम" },
  topics: { en: "Topics", hi: "विषय" },
  topic: { en: "Topic", hi: "विषय" },
  topicGaps: { en: "Topic gaps", hi: "विषयगत कमियाँ" },
  mistakes: { en: "Most common mistakes", hi: "सामान्य गलतियाँ" },
  needsWork: { en: "Needs work", hi: "सुधार आवश्यक" },
  onTrack: { en: "On track", hi: "सही पथ पर" },
  secure: { en: "Secure", hi: "पक्का" },
  improving: { en: "Improving", hi: "बेहतर हो रहा" },
  declining: { en: "Slipping", hi: "गिरावट" },
  steady: { en: "Steady", hi: "स्थिर" },
  export: { en: "Export", hi: "निर्यात" },
  download: { en: "Download", hi: "डाउनलोड" },
  print: { en: "Print", hi: "प्रिंट" },
  pdf: { en: "PDF", hi: "PDF" },
  excel: { en: "Excel", hi: "Excel" },
  word: { en: "Word", hi: "Word" },
  heatmap: { en: "Class heatmap", hi: "कक्षा हीटमैप" },
  atRisk: { en: "Needs attention", hi: "ध्यान चाहिए" },
  high: { en: "High", hi: "उच्च" },
  watch: { en: "Watch", hi: "निगरानी" },
  low: { en: "Low", hi: "कम" },
  riskScore: { en: "Risk score", hi: "जोखिम स्कोर" },
  why: { en: "Why", hi: "क्यों" },
  whatToDo: { en: "What to do", hi: "क्या करें" },
  lesson: { en: "Lesson plan", hi: "पाठ योजना" },
  materials: { en: "Materials", hi: "सामग्री" },
  minutes: { en: "minutes", hi: "मिनट" },
  save: { en: "Save", hi: "सहेजें" },
  cancel: { en: "Cancel", hi: "रद्द करें" },
  continue: { en: "Continue", hi: "आगे बढ़ें" },
  back: { en: "Back", hi: "वापस" },
  loading: { en: "Loading…", hi: "लोड हो रहा है…" },
  signIn: { en: "Sign in", hi: "साइन इन" },
  signOut: { en: "Sign out", hi: "साइन आउट" },
  email: { en: "Email", hi: "ईमेल" },
  password: { en: "Password", hi: "पासवर्ड" },
  name: { en: "Full name", hi: "पूरा नाम" },
  mark: { en: "Mark", hi: "अंक" },
  marks: { en: "Marks", hi: "अंक" },
  correct: { en: "Correct", hi: "सही" },
  wrong: { en: "Wrong", hi: "गलत" },
  blank: { en: "Not attempted", hi: "उत्तर नहीं दिया" },
  partial: { en: "Partial", hi: "आंशिक" },
  answered: { en: "Answered", hi: "उत्तरित" },
  student: { en: "Student", hi: "विद्यार्थी" },
  class: { en: "Class", hi: "कक्षा" },
  section: { en: "Section", hi: "सेक्शन" },
  rollNo: { en: "Roll no.", hi: "रोल नं." },
  term: { en: "Term", hi: "अवधि" },
  date: { en: "Date", hi: "तारीख" },
  title: { en: "Title", hi: "शीर्षक" },
  generate: { en: "Generate", hi: "बनाएँ" },
  generating: { en: "Building your paper…", hi: "आपका पेपर बन रहा है…" },
  upload: { en: "Upload a test", hi: "परीक्षा अपलोड करें" },
  orType: { en: "Or type the questions yourself", hi: "या प्रश्न स्वयं लिखें" },
  addStudent: { en: "Add student", hi: "विद्यार्थी जोड़ें" },
  noData: { en: "Nothing here yet", hi: "अभी यहाँ कुछ नहीं है" },
  settings: { en: "Settings", hi: "सेटिंग्स" },
};

/** Translate a key, falling back to English then to the key itself. */
export function t(locale: Locale, key: string): string {
  const entry = STRINGS[key];
  if (!entry) return key;
  return locale === "hi" ? entry.hi : entry.en;
}

/** Pick the right variant of a bilingual record. */
export function pick<T>(locale: Locale, en: T | null | undefined, hi: T | null | undefined): T | null {
  if (locale === "hi") return hi ?? en ?? null;
  return en ?? hi ?? null;
}
