import { FileSpreadsheet, FileText, FileType2, Printer } from "lucide-react";

/**
 * Export destinations for a test, in one place so a button, a menu and a
 * printed report can never disagree about what exists.
 *
 * Teachers in Indian schools overwhelmingly want one of two things: something
 * they can print for the class, or a spreadsheet they can put in the register.
 * Both are first-class here, and neither requires the internet.
 */
export function exportLinks(paperId: string) {
  return [
    { kind: "xlsx", label: "Excel", href: `/api/papers/${paperId}/export/xlsx`, icon: FileSpreadsheet },
    { kind: "docx", label: "Word", href: `/api/papers/${paperId}/export/docx`, icon: FileType2 },
    { kind: "pdf", label: "PDF", href: `/api/papers/${paperId}/export/pdf`, icon: FileText },
    { kind: "print", label: "Print", href: `/tests/${paperId}/print`, icon: Printer },
  ];
}
