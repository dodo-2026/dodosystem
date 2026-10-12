"use client";

import { useMemo, useRef, useState } from "react";
import ImportSettlementSheets from "./ImportSettlementSheets";
import { MAX_IMPORT_SOURCE_BYTES, MAX_IMPORT_WORKSPACE_BYTES, parseImportWorkspace, serializeImportWorkspace } from "@/lib/dodo/importWorkspace";
import {
  summarizeDodoImportRows,
  validateDodoImportBatch,
  type DodoImportIssue,
} from "@/lib/dodo/importValidation";
import { createDodoImportIssueReportCsv } from "@/lib/dodo/importIssueReport";
import { summarizeDodoImportIssues } from "@/lib/dodo/importIssueSummary";
import {
  createDodoImportSampleCsv,
  parseDodoImportText,
  type DodoImportTextIssue,
  type DodoImportTextResult,
} from "@/lib/dodo/importText";
import { formatFileSize, sha256Hex } from "@/lib/dodo/fileFingerprint";
import { createDodoImportConfirmationCsv } from "@/lib/dodo/importExport";
import { validateSharedImport, type SharedImportSummary } from "@/lib/dodo/sharedImport";
import {
  containsUnsafeControlCharacters,
  decodeUtf8File,
} from "@/lib/dodo/fileText";

const PREVIEW_ROW_LIMIT = 50;

type FileState = {
  name: string;
  sourceText: string;
  sizeBytes: number;
  sha256: string;
  parseResult: DodoImportTextResult;
};

function issueKey(
  issue: DodoImportIssue | DodoImportTextIssue,
  index: number
): string {
  return `${issue.code}-${issue.sourceRowNumber ?? "batch"}-${index}`;
}

function yen(value: number | bigint): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

function downloadTextFile(content: string, fileName: string, mime = "text/csv") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function ImportPreview() {
  const [sourcePartner, setSourcePartner] = useState("");
  const [statementMonth, setStatementMonth] = useState("");
  const [fileState, setFileState] = useState<FileState | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRequest = useRef(0);
  const [sharedBusy, setSharedBusy] = useState(false);
  const [sharedNotice, setSharedNotice] = useState("");
  const [sharedError, setSharedError] = useState("");
  const [savedDrafts, setSavedDrafts] = useState<SharedImportSummary[]>([]);
  const [listedMonth, setListedMonth] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const validation = useMemo(() => {
    if (
      fileState === null ||
      fileState.parseResult.issues.length > 0
    ) {
      return null;
    }

    return validateDodoImportBatch({
      sourcePartner,
      statementMonth,
      rows: fileState.parseResult.rows,
    });
  }, [fileState, sourcePartner, statementMonth]);

  const issues = [
    ...(fileState?.parseResult.issues ?? []),
    ...(validation?.issues ?? []),
  ];
  const issueSummary = useMemo(
    () =>
      summarizeDodoImportIssues([
        ...(fileState?.parseResult.issues ?? []),
        ...(validation?.issues ?? []),
      ]),
    [fileState, validation]
  );
  const isReady = fileState !== null && issues.length === 0;
  const totals =
    isReady && validation !== null
      ? summarizeDodoImportRows(validation.rows)
      : null;

  async function handleFile(file: File | undefined) {
    const requestId = ++fileRequest.current;
    setFileState(null);
    setFileError(null);
    setSharedNotice("");

    if (file === undefined) {
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase();

    if (extension !== "csv" && extension !== "tsv" && extension !== "json") {
      setFileError(
        "CSV・TSV、または保存したDODO作業ファイル（JSON）を選んでください。"
      );
      return;
    }

    const maxFileSize = extension === "json" ? MAX_IMPORT_WORKSPACE_BYTES : MAX_IMPORT_SOURCE_BYTES;
    if (file.size > maxFileSize) {
      setFileError(extension === "json"
        ? "作業ファイルは12MB以下にしてください（元のCSV・TSVは5MB以下）。"
        : "CSV・TSVのファイルサイズは5MB以下にしてください。");
      return;
    }

    try {
      const bytes = await file.arrayBuffer();
      if (requestId !== fileRequest.current) return;
      const text = decodeUtf8File(bytes);

      if (text === null) {
        setFileError(
          "文字コードをUTF-8として読み取れませんでした。Excelで「CSV UTF-8」として保存し直してください。"
        );
        return;
      }

      if (containsUnsafeControlCharacters(text)) {
        setFileError(
          "ファイル内にCSVまたはTSVでは使用できない制御文字が含まれています。元データを確認し、「CSV UTF-8」として保存し直してください。"
        );
        return;
      }

      const sha256 = await sha256Hex(bytes);
      if (requestId !== fileRequest.current) return;
      const workspace = extension === "json" ? parseImportWorkspace(text) : null;
      const sourceText = workspace?.sourceText ?? text;
      if (containsUnsafeControlCharacters(sourceText)) throw new Error("invalid text");
      if (workspace) {
        setSourcePartner(workspace.sourcePartner);
        setStatementMonth(workspace.statementMonth);
      }

      setFileState({
        name: file.name,
        sourceText,
        sizeBytes: file.size,
        sha256,
        parseResult: parseDodoImportText(sourceText),
      });
    } catch {
      if (requestId !== fileRequest.current) return;
      setFileError("ファイルを読み取れませんでした。CSV・TSVまたはDODO作業ファイルの内容を確認してください。");
    }
  }

  function downloadSampleCsv() {
    downloadTextFile(createDodoImportSampleCsv(), "dodo-import-sample.csv");
  }

  function downloadIssueReport() {
    if (fileState === null) {
      return;
    }

    downloadTextFile(
      createDodoImportIssueReportCsv(issues, {
        fileName: fileState.name,
        sizeBytes: fileState.sizeBytes,
        sha256: fileState.sha256,
      }),
      "dodo-import-errors.csv"
    );
  }

  function downloadConfirmationCsv() {
    if (validation === null || !validation.canConfirm) return;
    downloadTextFile(
      createDodoImportConfirmationCsv(validation),
      `dodo-confirmed-${validation.statementMonth ?? statementMonth}.csv`
    );
  }

  async function sharedRequest(path: string, init?: RequestInit) {
    const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
    if (response.status === 401 || response.redirected) throw new Error("社内ログインし直してから操作してください。");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "共有保存の処理に失敗しました。");
    return data;
  }

  async function saveSharedDraft() {
    if (!fileState || !isReady || sharedBusy) return;
    setSharedBusy(true); setSharedNotice(""); setSharedError("");
    try {
      const workspaceText = serializeImportWorkspace({ sourcePartner, statementMonth, sourceText: fileState.sourceText });
      validateSharedImport(workspaceText);
      const result = await sharedRequest("/api/import-drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceText }),
      });
      setSavedDrafts([]); setListedMonth(""); setNextCursor(null);
      setSharedNotice(`${result.alreadySaved ? "同じ内容は保存済みです" : "共有保存しました"}：${result.draft.row_count}件。保存先から開き直しています。`);
      try {
        const reopened = await sharedRequest(`/api/import-drafts?id=${encodeURIComponent(result.draft.id)}`);
        await applySharedDraft(reopened);
        setSharedNotice(`${result.alreadySaved ? "保存済みの同じ内容" : "共有保存した内容"}を保存先から開き直しました：${reopened.draft.row_count}件。合計と精算書を確認してください。`);
      } catch {
        setSharedNotice("共有保存は完了しましたが、保存先からの再表示を確認できませんでした。この月の保存済み一覧から開いて確認してください。");
      }
    } catch (error) { setSharedError(error instanceof Error ? error.message : "共有保存に失敗しました。保存済み一覧を確認してから再試行してください。"); }
    finally { setSharedBusy(false); }
  }

  async function listSharedDrafts(append = false) {
    if (!statementMonth || sharedBusy) return;
    if (append && (!nextCursor || listedMonth !== statementMonth)) return;
    setSharedBusy(true); setSharedError("");
    if (!append) { setSavedDrafts([]); setListedMonth(""); setNextCursor(null); }
    try {
      const cursor = append ? `&before=${encodeURIComponent(nextCursor!)}` : "";
      const result = await sharedRequest(`/api/import-drafts?month=${encodeURIComponent(statementMonth)}${cursor}`);
      setSavedDrafts(current => append ? [...current, ...result.drafts] : result.drafts);
      setListedMonth(statementMonth); setNextCursor(result.nextCursor);
    } catch (error) { setSharedError(error instanceof Error ? error.message : "保存済み一覧を取得できませんでした。"); }
    finally { setSharedBusy(false); }
  }

  async function restoreSharedDraft(id: string) {
    if (sharedBusy || (fileState && !window.confirm("画面の取込内容を保存済みデータに置き換えます。未保存の内容が必要なら先に作業ファイルを保存してください。"))) return;
    const requestId = ++fileRequest.current;
    setSharedBusy(true); setSharedError("");
    try {
      const result = await sharedRequest(`/api/import-drafts?id=${encodeURIComponent(id)}`);
      await applySharedDraft(result, requestId);
      setSharedNotice(`保存済みデータを開きました：${result.draft.row_count}件。合計と精算書を確認してください。`);
    } catch (error) { setSharedError(error instanceof Error ? error.message : "保存済みデータを開けませんでした。"); }
    finally { setSharedBusy(false); }
  }

  async function applySharedDraft(result: { draft: SharedImportSummary; workspace: unknown }, requestId = fileRequest.current) {
    const { workspace } = validateSharedImport(serializeImportWorkspace(result.workspace as Parameters<typeof serializeImportWorkspace>[0]));
    const bytes = new TextEncoder().encode(workspace.sourceText);
    const sha256 = await sha256Hex(bytes.buffer);
    if (requestId !== fileRequest.current) return;
    setSourcePartner(workspace.sourcePartner); setStatementMonth(workspace.statementMonth);
    setFileError(null);
    setFileState({ name: `保存済み ${result.draft.source_partner} ${workspace.statementMonth}`,
      sourceText: workspace.sourceText, sizeBytes: bytes.byteLength, sha256,
      parseResult: parseDodoImportText(workspace.sourceText) });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-base font-black text-emerald-950">
          取込内容を確認して保存・出力
        </h2>
        <p className="mt-2 text-sm leading-7 text-emerald-900">
          確認OKの取込内容は、作業ファイルとして保存できます。共有保存の設定済み環境では、別の端末でも保存済みデータを開けます。保存しても振込や領収書発行は行われません。
        </p>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">取込条件</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-bold text-slate-700">
            取込元
            <input
              value={sourcePartner}
              disabled={sharedBusy}
              onChange={(event) => { setSourcePartner(event.target.value); setSharedNotice(""); }}
              placeholder="例：WeChat免税店"
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base font-normal outline-none focus:border-slate-950"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            対象月
            <input
              type="month"
              value={statementMonth}
              disabled={sharedBusy}
              onChange={(event) => { setStatementMonth(event.target.value); setSharedNotice(""); setSavedDrafts([]); setListedMonth(""); setNextCursor(null); }}
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base font-normal outline-none focus:border-slate-950"
            />
          </label>
        </div>

        <label className="mt-4 block rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 text-center">
          <span className="block text-sm font-black text-slate-900">
            CSV・TSVまたは保存した作業ファイルを選択
          </span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            CSV・TSVは5MB以下、保存した作業ファイル（JSON）は12MB以下に対応
          </span>
          <input
            type="file"
            disabled={sharedBusy}
            accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json"
            onChange={(event) => void handleFile(event.target.files?.[0])}
            className="mt-4 block w-full text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:font-bold file:text-white"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={downloadSampleCsv}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-50"
          >
            見本CSVをダウンロード
          </button>
          <p className="text-xs leading-5 text-slate-500">
            ブラウザー内で作成します。見本の金額は入力例で、精算式や月会費を表しません。
          </p>
        </div>

        {fileError ? (
          <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold leading-6 text-red-800">
            {fileError}
          </p>
        ) : null}
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">共有保存・保存済みデータ</h2>
        <p className="mt-2 text-sm text-slate-600">対象月を選び、保存済み一覧を表示してください。共有保存は作業ファイル1MB以下。一覧は新しい順に20件ずつ表示できます。</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled={sharedBusy || !isReady || !validation?.canConfirm}
            onClick={() => void saveSharedDraft()}
            className="rounded-xl bg-slate-950 px-4 py-3 font-bold text-white disabled:opacity-40">取込内容を共有保存</button>
          <button type="button" disabled={sharedBusy || !statementMonth}
            onClick={() => void listSharedDrafts()}
            className="rounded-xl border border-slate-300 px-4 py-3 font-bold disabled:opacity-40">この月の保存済み一覧</button>
        </div>
        <div aria-live="polite" className="mt-3 text-sm">
          {sharedBusy ? <p>処理中です…</p> : null}
          {sharedNotice ? <p className="text-emerald-900">{sharedNotice}</p> : null}
          {sharedError ? <p role="alert" className="text-red-800">{sharedError}</p> : null}
        </div>
        {listedMonth && savedDrafts.length === 0 ? <p className="mt-3 text-sm">{listedMonth}の保存済みデータはありません。</p> : null}
        <ul className="mt-4 space-y-3">
          {savedDrafts.map((draft) => <li key={draft.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <div><p className="font-bold">{draft.source_partner}・{draft.statement_month}・{draft.row_count}件</p>
              <p className="text-xs text-slate-500">{new Date(draft.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p></div>
            <button type="button" disabled={sharedBusy} onClick={() => void restoreSharedDraft(draft.id)}
              className="rounded-xl border border-slate-300 px-4 py-2 font-bold disabled:opacity-40">開く</button>
          </li>)}
        </ul>
        {nextCursor && listedMonth === statementMonth ? <button type="button" disabled={sharedBusy}
          onClick={() => void listSharedDrafts(true)}
          className="mt-4 rounded-xl border border-slate-300 px-4 py-3 font-bold disabled:opacity-40">続きを表示</button> : null}
      </section>

      {fileState ? (
        <>
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">確認結果</h2>
                <p className="mt-1 break-all text-xs text-slate-500">
                  {fileState.name}
                </p>
                <dl className="mt-3 grid gap-1 text-xs text-slate-600">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-bold">ファイルサイズ</dt>
                    <dd>{formatFileSize(fileState.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt className="font-bold">SHA-256（ファイル識別値）</dt>
                    <dd className="mt-1 break-all font-mono text-[11px] leading-5 text-slate-500">
                      {fileState.sha256}
                    </dd>
                  </div>
                </dl>
              </div>
              <div
                className={`rounded-full px-4 py-2 text-sm font-black ${
                  isReady
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-red-100 text-red-900"
                }`}
              >
                {isReady ? "確認OK" : `${issues.length}件の要確認`}
              </div>
            </div>

            {issues.length > 0 ? (
              <div className="mt-4 space-y-2">
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-xs font-black text-red-900">
                    エラーの種類別集計
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {issueSummary.map((item) => (
                      <span
                        key={item.code}
                        className="rounded-full bg-white px-3 py-1 text-xs font-bold text-red-800"
                      >
                        {item.label} {item.count.toLocaleString("ja-JP")}件
                      </span>
                    ))}
                  </div>
                </div>
                {issues.slice(0, 100).map((issue, index) => (
                  <div
                    key={issueKey(issue, index)}
                    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-900"
                  >
                    {issue.sourceRowNumber
                      ? `${issue.sourceRowNumber}行目：`
                      : ""}
                    {issue.message}
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={downloadIssueReport}
                    className="rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-black text-red-800 hover:bg-red-50"
                  >
                    エラー全件をCSVで保存
                  </button>
                  <p className="text-xs leading-5 text-slate-500">
                    全{issues.length.toLocaleString("ja-JP")}件をブラウザー内で作成します。
                    {issues.length > 100
                      ? "画面表示は先頭100件ですが、CSVには全件入ります。"
                      : "ファイルや結果は外部送信されません。"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold leading-6 text-emerald-900">
                必須列・日付・整数円・ファイル内重複に問題はありません。これは保存前の確認結果です。
              </p>
            )}
          </section>

          {totals ? (
            <section className="rounded-3xl bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">取込合計</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-bold text-slate-500">明細件数</p>
                  <p className="mt-1 text-xl font-black text-slate-950">
                    {totals.rowCount.toLocaleString("ja-JP")}件
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-bold text-slate-500">COM合計</p>
                  <p className="mt-1 text-xl font-black text-slate-950">
                    {yen(totals.grossComYen)}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-bold text-slate-500">
                    DODO手数料合計
                  </p>
                  <p className="mt-1 text-xl font-black text-slate-950">
                    {yen(totals.dodoFeeYen)}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-bold text-slate-500">
                    ガイド支払額合計
                  </p>
                  <p className="mt-1 text-xl font-black text-slate-950">
                    {yen(totals.guidePaymentYen)}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">
                3つの金額列をそれぞれ単純合計しています。金額間の計算式や月会費は判定していません。
              </p>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-3xl bg-white shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3 px-5 py-4">
              <div>
                <h2 className="text-lg font-black text-slate-950">
                  取込プレビュー
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  読取{fileState.parseResult.rows.length}行・表示は最大{PREVIEW_ROW_LIMIT}行
                </p>
              </div>
              <span className="text-xs font-bold text-slate-500">
                {fileState.parseResult.delimiter === "\t" ? "TSV" : "CSV"}
              </span>
            </div>

            {validation === null ? (
              <div className="border-t border-slate-200 bg-amber-50 px-5 py-5 text-sm font-bold leading-6 text-amber-900">
                ファイルの列構成を直すと、正規化した取込内容をここで確認できます。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                <thead className="bg-slate-950 text-left text-white">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3">元の行</th>
                    <th className="whitespace-nowrap px-4 py-3">参照番号</th>
                    <th className="whitespace-nowrap px-4 py-3">ガイド</th>
                    <th className="whitespace-nowrap px-4 py-3">稼働日</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">COM</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">DODO手数料</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">ガイド支払</th>
                  </tr>
                </thead>
                <tbody>
                  {(validation?.rows ?? [])
                    .slice(0, PREVIEW_ROW_LIMIT)
                    .map((row) => (
                      <tr key={row.sourceRowNumber} className="border-t border-slate-100">
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                          {row.sourceRowNumber}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {row.externalReference ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold">
                          {row.guideCode}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{row.workDate}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {yen(row.grossComYen)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {yen(row.dodoFeeYen)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-bold">
                          {yen(row.guidePaymentYen)}
                        </td>
                      </tr>
                    ))}
                </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-6 text-slate-700">
              {isReady && validation ? (
                <div className="flex flex-wrap gap-3">
                  <button type="button" className="rounded-xl bg-slate-950 px-4 py-3 font-bold text-white" onClick={() => downloadTextFile(serializeImportWorkspace({ sourcePartner, statementMonth, sourceText: fileState.sourceText }), `dodo-workspace-${statementMonth}.json`, "application/json")}>作業ファイルをパソコンに保存</button>
                  <button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-3 font-bold text-slate-900" onClick={downloadConfirmationCsv}>確認済み明細をCSV出力</button>
                </div>
              ) : "要確認項目を直すと、作業ファイルの保存と精算書出力ができます。"}
            </div>
          </section>
          {isReady && validation ? <ImportSettlementSheets batch={validation} /> : null}
        </>
      ) : null}
    </div>
  );
}
