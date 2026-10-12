import assert from "node:assert/strict";
import test from "node:test";

import { summarizeDodoImportIssues } from "../lib/dodo/importIssueSummary.ts";

test("groups import issues and shows the most common type first", () => {
  const summary = summarizeDodoImportIssues([
    { code: "required" },
    { code: "invalid_amount" },
    { code: "required" },
    { code: "duplicate" },
    { code: "invalid_amount" },
    { code: "invalid_amount" },
  ]);

  assert.deepEqual(summary, [
    { code: "invalid_amount", label: "金額エラー", count: 3 },
    { code: "required", label: "必須項目", count: 2 },
    { code: "duplicate", label: "重複", count: 1 },
  ]);
});

test("preserves first-seen order for ties and retains unknown codes", () => {
  assert.deepEqual(
    summarizeDodoImportIssues([
      { code: "future_issue" },
      { code: "missing_column" },
    ]),
    [
      {
        code: "future_issue",
        label: "その他（future_issue）",
        count: 1,
      },
      { code: "missing_column", label: "必須列不足", count: 1 },
    ]
  );
});
