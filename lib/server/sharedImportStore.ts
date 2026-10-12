import { createHash } from "node:crypto";
import { SHARED_IMPORT_ID, validateSharedImport, type SharedImportSummary } from "../dodo/sharedImport.ts";

const PREVIEW_URL = "https://zyyrzrncecpqvzmcocer.supabase.co";
const TABLE = "office_import_drafts";
const SUMMARY_COLUMNS = "id,source_partner,statement_month,row_count,created_at";
const PAGE_SIZE = 20;
// Preserve database microseconds for stable ordering, but exclude filter syntax.
const DATABASE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
export class SharedImportStoreError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
type Config = { url: string; key: string };

export function sharedImportConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // This first trial cannot write to Production or another project's database.
  if (env.VERCEL_ENV === "production" || env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== PREVIEW_URL) {
    throw new SharedImportStoreError(503, "共有保存はDODOの試用環境でのみ利用できます。");
  }
  const key = env.DODO_PREVIEW_SUPABASE_SECRET_KEY;
  let isServiceRole = false;
  if (key && !key.startsWith("sb_secret_")) {
    try { isServiceRole = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "service_role"; } catch { /* invalid key */ }
  }
  if (!key || (!key.startsWith("sb_secret_") && !isServiceRole)) {
    throw new SharedImportStoreError(503, "共有保存の接続設定がまだ完了していません。作業ファイルの保存は利用できます。");
  }
  return { url: PREVIEW_URL, key };
}

type StoredDraft = SharedImportSummary & { workspace_text: string; content_hash: string };
export function draftFingerprint(text: string) { return createHash("sha256").update(text).digest("hex"); }

export function createSharedImportStore(config: Config, fetcher: typeof fetch = fetch) {
  async function request(query: Record<string, string>, init: RequestInit = {}) {
    const headers: Record<string, string> = { apikey: config.key, "Content-Type": "application/json" };
    // Modern secret API keys go only in apikey, legacy JWTs also use Bearer.
    if (!config.key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${config.key}`;
    if (init.method === "POST") headers.Prefer = "return=representation";
    let result: Response;
    try {
      result = await fetcher(`${config.url}/rest/v1/${TABLE}?${new URLSearchParams(query)}`, {
        ...init, headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
      });
    } catch { throw new SharedImportStoreError(503, "共有保存先に接続できませんでした。時間をおいて再試行してください。"); }
    if (result.status === 409) throw new SharedImportStoreError(409, "同じ取込内容は保存済みです。");
    if (!result.ok) throw new SharedImportStoreError(503, "共有保存先の設定を確認してください。作業ファイルの保存は利用できます。");
    const rows: unknown = await result.json();
    if (!Array.isArray(rows)) throw new SharedImportStoreError(503, "共有保存先から正しい応答がありませんでした。");
    return rows;
  }
  function summary(value: unknown): SharedImportSummary {
    const row = value as SharedImportSummary;
    if (!row || typeof row.id !== "string" || !SHARED_IMPORT_ID.test(row.id) ||
        typeof row.source_partner !== "string" || typeof row.statement_month !== "string" ||
        !Number.isSafeInteger(row.row_count) || row.row_count < 1 ||
        typeof row.created_at !== "string" || !DATABASE_TIMESTAMP.test(row.created_at) || !Number.isFinite(Date.parse(row.created_at))) {
      throw new SharedImportStoreError(503, "保存済みデータの形式が違います。");
    }
    return { id: row.id, source_partner: row.source_partner, statement_month: row.statement_month,
      row_count: row.row_count, created_at: row.created_at };
  }
  return {
    async list(month: string, before?: string) {
      const query: Record<string, string> = {
        select: SUMMARY_COLUMNS, statement_month: `eq.${month}`,
        order: "created_at.desc,id.desc", limit: String(PAGE_SIZE + 1),
      };
      if (before) {
        const anchors = await request({ select: SUMMARY_COLUMNS, id: `eq.${before}`, statement_month: `eq.${month}`, limit: "1" });
        if (anchors.length !== 1) throw new SharedImportStoreError(409, "一覧の続きを取得できません。この月の保存済み一覧を表示し直してください。");
        const anchor = summary(anchors[0]);
        if (anchor.id !== before || anchor.statement_month !== month) throw new SharedImportStoreError(409, "対象月の保存済み一覧を表示し直してください。");
        query.or = `(created_at.lt.${anchor.created_at},and(created_at.eq.${anchor.created_at},id.lt.${anchor.id}))`;
      }
      const rows = (await request(query)).map(summary);
      const drafts = rows.slice(0, PAGE_SIZE);
      return { drafts, nextCursor: rows.length > PAGE_SIZE ? drafts[PAGE_SIZE - 1].id : null };
    },
    async save(text: string) {
      const valid = validateSharedImport(text);
      const hash = draftFingerprint(valid.canonical);
      try {
        const rows = await request({ select: SUMMARY_COLUMNS }, { method: "POST", body: JSON.stringify({
          source_partner: valid.workspace.sourcePartner, statement_month: valid.workspace.statementMonth,
          row_count: valid.rowCount, workspace_text: valid.canonical, content_hash: hash,
        }) });
        return { draft: summary(rows[0]), alreadySaved: false };
      } catch (error) {
        if (!(error instanceof SharedImportStoreError) || error.status !== 409) throw error;
        const rows = await request({ select: SUMMARY_COLUMNS, content_hash: `eq.${hash}`, limit: "1" });
        if (rows.length !== 1) throw new SharedImportStoreError(503, "保存結果を確認できませんでした。保存済み一覧から確認してください。");
        return { draft: summary(rows[0]), alreadySaved: true };
      }
    },
    async load(id: string) {
      const rows = await request({ select: `${SUMMARY_COLUMNS},workspace_text,content_hash`, id: `eq.${id}`, limit: "1" });
      if (rows.length !== 1) throw new SharedImportStoreError(404, "保存済みデータが見つかりません。");
      const row = rows[0] as StoredDraft;
      const draft = summary(row);
      try {
        const valid = validateSharedImport(row.workspace_text);
        if (draftFingerprint(valid.canonical) !== row.content_hash || valid.rowCount !== draft.row_count ||
            valid.workspace.sourcePartner !== draft.source_partner || valid.workspace.statementMonth !== draft.statement_month) throw new Error();
        return { draft, workspace: valid.workspace };
      } catch { throw new SharedImportStoreError(409, "保存済みデータの整合性を確認できませんでした。元の作業ファイルを確認してください。"); }
    },
  };
}
