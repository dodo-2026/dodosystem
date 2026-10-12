import type { DodoImportBatchValidation } from "./importValidation";

function csvText(value: string): string {
  // Spreadsheet apps may evaluate cells that begin with these characters.
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function createDodoImportConfirmationCsv(
  batch: DodoImportBatchValidation
): string {
  const sourcePartner = batch.sourcePartner;
  const statementMonth = batch.statementMonth;
  if (
    !batch.canConfirm ||
    sourcePartner === null ||
    statementMonth === null
  ) {
    throw new Error("確認済みの取込内容だけCSVに出力できます。");
  }

  const header = [
    "取込元",
    "対象月",
    "元の行",
    "外部参照番号",
    "ガイドコード",
    "稼働日",
    "COM金額",
    "DODO手数料",
    "ガイド支払額",
  ].join(",");
  const rows = batch.rows.map((row) =>
    [
      csvText(sourcePartner),
      csvText(statementMonth),
      String(row.sourceRowNumber),
      csvText(row.externalReference ?? ""),
      csvText(row.guideCode),
      csvText(row.workDate),
      String(row.grossComYen),
      String(row.dodoFeeYen),
      String(row.guidePaymentYen),
    ].join(",")
  );

  return `\uFEFF${[header, ...rows, ""].join("\r\n")}`;
}
