import { MAX_SHARED_IMPORT_BYTES, SHARED_IMPORT_ID, SHARED_IMPORT_MONTH } from "../dodo/sharedImport.ts";
import { createSharedImportStore, sharedImportConfig, SharedImportStoreError } from "./sharedImportStore.ts";

type Dependencies = {
  authorize: () => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
};
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
function reply(value: unknown, status = 200) { return Response.json(value, { status, headers }); }

async function boundedJson(request: Request) {
  if (!request.body) throw new SharedImportStoreError(400, "保存する内容がありません。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    // JSON wrapping may escape the workspace text again.
    if (size > MAX_SHARED_IMPORT_BYTES * 2 + 1024) {
      await reader.cancel();
      throw new SharedImportStoreError(413, "共有保存できるサイズを超えています。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new SharedImportStoreError(400, "保存する内容の形式が違います。"); }
}

export async function handleSharedImport(request: Request, deps: Dependencies) {
  try {
    // Authentication must precede body parsing, configuration and every DB request.
    if (!(await deps.authorize())) return reply({ error: "社内ログインが必要です。" }, 401);
    const url = new URL(request.url);
    if (request.method === "POST") {
      if (request.headers.get("origin") !== url.origin) return reply({ error: "この画面から保存し直してください。" }, 403);
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply({ error: "保存形式が違います。" }, 415);
      const body = await boundedJson(request);
      if (!body || typeof body !== "object" || typeof (body as { workspaceText?: unknown }).workspaceText !== "string") {
        return reply({ error: "保存する内容がありません。" }, 400);
      }
      const text = (body as { workspaceText: string }).workspaceText;
      // Validate before obtaining privileged database access.
      const { validateSharedImport } = await import("../dodo/sharedImport.ts");
      try { validateSharedImport(text); } catch (error) { return reply({ error: error instanceof Error ? error.message : "取込内容を確認してください。" }, 400); }
      const store = createSharedImportStore(sharedImportConfig(deps.env), deps.fetcher);
      return reply(await store.save(text));
    }
    if (request.method !== "GET") return reply({ error: "対応していない操作です。" }, 405);
    const id = url.searchParams.get("id");
    const month = url.searchParams.get("month");
    const before = url.searchParams.get("before");
    if ((id !== null && !SHARED_IMPORT_ID.test(id)) || (id === null && (!month || !SHARED_IMPORT_MONTH.test(month))) ||
        (before !== null && (!SHARED_IMPORT_ID.test(before) || id !== null))) {
      return reply({ error: "対象月または保存番号を確認してください。" }, 400);
    }
    const store = createSharedImportStore(sharedImportConfig(deps.env), deps.fetcher);
    return reply(id !== null ? await store.load(id) : await store.list(month!, before ?? undefined));
  } catch (error) {
    if (error instanceof SharedImportStoreError) return reply({ error: error.message }, error.status);
    return reply({ error: "共有保存の処理に失敗しました。保存済み一覧を確認してから再試行してください。" }, 503);
  }
}
