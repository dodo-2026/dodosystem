import assert from "node:assert/strict";
import test from "node:test";

import { createDodoImportIssueReportCsv } from "../lib/dodo/importIssueReport.ts";

test("creates a UTF-8 CSV containing every import issue", () => {
  const report = createDodoImportIssueReportCsv(
    [
      {
        code: "invalid_amount",
        field: "grossComYen",
        message: "金額は0以上の整数（円）で指定してください。",
        sourceRowNumber: 12,
      },
      {
        code: "custom",
        message: 'カンマ, 改行\n引用符"も保持します。',
      },
    ],
    {
      fileName: "wechat-2026-10.csv",
      sizeBytes: 1234,
      sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    }
  );

  assert.equal(report.startsWith("\uFEFF"), true);
  assert.match(report, /"元ファイル名","wechat-2026-10.csv"/);
  assert.match(report, /"ファイルサイズ（バイト）","1234"/);
  assert.match(
    report,
    /"SHA-256","ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"/
  );
  assert.match(report, /"エラーの種類","件数"/);
  assert.match(report, /"金額エラー","1"/);
  assert.match(report, /"その他（custom）","1"/);
  assert.match(report, /"12","invalid_amount","grossComYen"/);
  assert.match(report, /"","custom",""/);
  assert.match(report, /カンマ, 改行\n引用符""も保持します。/);
  assert.equal(report.split("\r\n").at(-1), "");
});

test("creates a header-only report when there are no issues", () => {
  assert.equal(
    createDodoImportIssueReportCsv([], {
      fileName: "empty.csv",
      sizeBytes: 0,
      sha256: "0".repeat(64),
    }),
    `\uFEFF"元ファイル名","empty.csv"\r\n"ファイルサイズ（バイト）","0"\r\n"SHA-256","${"0".repeat(64)}"\r\n\r\n"エラーの種類","件数"\r\n\r\n"元の行","コード","項目","内容"\r\n`
  );
});

test("puts the most frequent issue type first in the report summary", () => {
  const report = createDodoImportIssueReportCsv(
    [
      { code: "invalid_amount", message: "1" },
      { code: "required", message: "2" },
      { code: "invalid_amount", message: "3" },
    ],
    { fileName: "report.csv", sizeBytes: 1, sha256: "a".repeat(64) }
  );

  assert.ok(report.indexOf('"金額エラー","2"') < report.indexOf('"必須項目","1"'));
});

test("neutralizes spreadsheet formulas in source names and issue text", () => {
  const report = createDodoImportIssueReportCsv(
    [{ code: "custom", message: "=DANGEROUS()" }],
    {
      fileName: "+formula.csv",
      sizeBytes: 10,
      sha256: "f".repeat(64),
    }
  );

  assert.match(report, /"元ファイル名","'\+formula.csv"/);
  assert.match(report, /"","custom","","'=DANGEROUS\(\)"/);
});
