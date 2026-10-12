export type DodoImportIssueSummaryInput = {
  code: string;
};

export type DodoImportIssueSummary = {
  code: string;
  label: string;
  count: number;
};

const ISSUE_LABELS: Readonly<Record<string, string>> = {
  required: "必須項目",
  invalid_format: "形式エラー",
  invalid_amount: "金額エラー",
  invalid_row_number: "行番号エラー",
  duplicate: "重複",
  empty_rows: "取込明細なし",
  empty_file: "空ファイル",
  unclosed_quote: "引用符エラー",
  too_many_rows: "明細数上限超過",
  too_many_columns: "列数上限超過",
  cell_too_long: "セル文字数上限超過",
  missing_column: "必須列不足",
  duplicate_column: "重複列",
  empty_header: "空の見出し",
  column_count_mismatch: "列数不一致",
  empty_data: "ファイル明細なし",
  repeated_header: "途中の見出し行",
};

export function summarizeDodoImportIssues(
  issues: readonly DodoImportIssueSummaryInput[]
): DodoImportIssueSummary[] {
  const counts = new Map<string, { count: number; firstIndex: number }>();

  issues.forEach((issue, index) => {
    const existing = counts.get(issue.code);

    if (existing === undefined) {
      counts.set(issue.code, { count: 1, firstIndex: index });
    } else {
      existing.count += 1;
    }
  });

  return [...counts.entries()]
    .sort(
      ([, left], [, right]) =>
        right.count - left.count || left.firstIndex - right.firstIndex
    )
    .map(([code, { count }]) => ({
      code,
      label: ISSUE_LABELS[code] ?? `その他（${code}）`,
      count,
    }));
}
