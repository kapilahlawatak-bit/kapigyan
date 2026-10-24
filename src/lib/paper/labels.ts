export const SOURCE_LABEL: Record<string, string> = {
  UPLOADED: "Uploaded",
  GENERATED: "Generated",
  MANUAL: "Typed in",
};

export const COMPETENCY_LABEL: Record<string, string> = {
  basic: "Basic",
  competent: "Competent",
  proficient: "Proficient",
};

export const ENTRY_MODE_LABEL: Record<string, string> = {
  AOM: "Marked on paper",
  AUTO_OCR: "Photo marked",
  STUDENT_ONLINE: "Taken online",
};

export const TERM_OPTIONS = [
  "Term 1", "Term 2", "Term 3",
  "Unit test 1", "Unit test 2",
  "Half yearly", "Pre-board", "Practice",
] as const;
