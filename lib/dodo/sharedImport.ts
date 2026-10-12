import { containsUnsafeControlCharacters } from "./fileText.ts";
import { parseDodoImportText } from "./importText.ts";
import { validateDodoImportBatch } from "./importValidation.ts";
import { parseImportWorkspace, serializeImportWorkspace } from "./importWorkspace.ts";

// Bound both JSON request and stored workspace below the hosting request limit.
export const MAX_SHARED_IMPORT_BYTES = 1024 * 1024;
export const SHARED_IMPORT_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const SHARED_IMPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SharedImportSummary = {
  id: string;
  source_partner: string;
  statement_month: string;
  row_count: number;
  created_at: string;
};

export function validateSharedImport(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_SHARED_IMPORT_BYTES) {
    throw new Error("共有保存は作業ファイル1MB以下に対応しています。大きいファイルはパソコンに保存してください。");
  }
  const workspace = parseImportWorkspace(text);
  if (workspace.sourcePartner.length > 200 || containsUnsafeControlCharacters(workspace.sourcePartner) ||
      containsUnsafeControlCharacters(workspace.sourceText)) {
    throw new Error("取込元または明細に使用できない文字が含まれています。");
  }
  const parsed = parseDodoImportText(workspace.sourceText);
  const validation = validateDodoImportBatch({ ...workspace, rows: parsed.rows });
  if (parsed.issues.length > 0 || !validation.canConfirm) {
    throw new Error("取込内容の要確認項目を修正してから共有保存してください。");
  }
  const canonical = serializeImportWorkspace({
    sourcePartner: validation.sourcePartner!, statementMonth: validation.statementMonth!,
    sourceText: workspace.sourceText,
  });
  if (new TextEncoder().encode(canonical).byteLength > MAX_SHARED_IMPORT_BYTES) {
    throw new Error("共有保存できるサイズを超えています。作業ファイルをパソコンに保存してください。");
  }
  return { workspace: parseImportWorkspace(canonical), canonical, rowCount: validation.rows.length };
}
