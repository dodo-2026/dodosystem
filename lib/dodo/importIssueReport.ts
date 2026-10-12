export type DodoImportReportIssue = {
  code: string;
  field?: string;
  message: string;
  sourceRowNumber?: number;
};

export type DodoImportReportSource = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
};

function csvCell(value: string | number | undefined): string {
  const text = String(value ?? "");
  const spreadsheetSafeText = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;

  return `"${spreadsheetSafeText.replaceAll('"', '""')}"`;
}

export function createDodoImportIssueReportCsv(
  issues: readonly DodoImportReportIssue[],
  source: DodoImportReportSource
): string {
  const summary = summarizeDodoImportIssues(issues);
  const rows = [
    ["元ファイル名", source.fileName],
    ["ファイルサイズ（バイト）", source.sizeBytes],
    ["SHA-256", source.sha256],
    [],
    ["エラーの種類", "件数"],
    ...summary.map((item) => [item.label, item.count]),
    [],
    ["元の行", "コード", "項目", "内容"],
    ...issues.map((issue) => [
      issue.sourceRowNumber,
      issue.code,
      issue.field,
      issue.message,
    ]),
  ];

  return `\uFEFF${rows
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n")}\r\n`;
}
import { summarizeDodoImportIssues } from "./importIssueSummary.ts";
