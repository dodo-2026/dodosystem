import type { DodoImportBatchValidation } from "./importValidation";

export const MAX_IMPORT_SOURCE_BYTES = 5 * 1024 * 1024;
// JSON escaping can double the original CSV size. Reserve space for metadata.
export const MAX_IMPORT_WORKSPACE_BYTES = 12 * 1024 * 1024;

export type ImportWorkspace = {
  format: "dodo-import-workspace";
  version: 1;
  sourcePartner: string;
  statementMonth: string;
  sourceText: string;
};

export function serializeImportWorkspace(input: Omit<ImportWorkspace, "format" | "version">): string {
  return JSON.stringify({ format: "dodo-import-workspace", version: 1, ...input }, null, 2);
}

export function parseImportWorkspace(text: string): ImportWorkspace {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_WORKSPACE_BYTES) {
    throw new Error("作業ファイルは12MB以下にしてください。");
  }
  const data: unknown = JSON.parse(text);
  if (typeof data !== "object" || data === null) throw new Error("作業ファイルの形式が違います。");
  const value = data as Record<string, unknown>;
  if (value.format !== "dodo-import-workspace" || value.version !== 1 ||
      typeof value.sourcePartner !== "string" || typeof value.statementMonth !== "string" ||
      typeof value.sourceText !== "string" ||
      new TextEncoder().encode(value.sourceText).byteLength > MAX_IMPORT_SOURCE_BYTES) {
    throw new Error("対応しているDODO作業ファイルではありません。");
  }
  return { format: "dodo-import-workspace", version: 1, sourcePartner: value.sourcePartner,
    statementMonth: value.statementMonth, sourceText: value.sourceText };
}

export function groupImportByGuide(batch: DodoImportBatchValidation) {
  if (!batch.canConfirm) return [];
  const groups = new Map<string, typeof batch.rows>();
  for (const row of batch.rows) {
    const rows = groups.get(row.guideCode) ?? [];
    rows.push(row);
    groups.set(row.guideCode, rows);
  }
  return Array.from(groups, ([guideCode, rows]) => ({ guideCode, rows }));
}
