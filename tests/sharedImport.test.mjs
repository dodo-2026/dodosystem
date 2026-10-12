import assert from "node:assert/strict";
import test from "node:test";
import { handleSharedImport } from "../lib/server/sharedImportApi.ts";
import { sharedImportConfig, draftFingerprint } from "../lib/server/sharedImportStore.ts";
import { validateSharedImport, MAX_SHARED_IMPORT_BYTES } from "../lib/dodo/sharedImport.ts";
import { serializeImportWorkspace, parseImportWorkspace } from "../lib/dodo/importWorkspace.ts";
import { parseDodoImportText } from "../lib/dodo/importText.ts";
import { validateDodoImportBatch, summarizeDodoImportRows } from "../lib/dodo/importValidation.ts";
import { createDodoImportConfirmationCsv } from "../lib/dodo/importExport.ts";

const origin = "https://dodo-preview.example";
const env = { VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://zyyrzrncecpqvzmcocer.supabase.co", DODO_PREVIEW_SUPABASE_SECRET_KEY: "sb_secret_test_only" };
const text = serializeImportWorkspace({ sourcePartner: "免税店", statementMonth: "2026-10",
  sourceText: ["外部参照番号,ガイドコード,稼働日,COM金額,DODO手数料,ガイド支払額",
    ...Array.from({length:60}, (_, i) => `R${i},G${i % 2},2026-10-01,12000,1500,9250`)].join("\n") });
function post(workspaceText = text, requestOrigin = origin) {
  return new Request(`${origin}/api/import-drafts`, { method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceText }) });
}

test("shared save, retry, list and reopen preserve all 60 rows and CSV totals", async () => {
  const records = [];
  const fetcher = async (url, init) => {
    assert.equal(new URL(url).origin, env.NEXT_PUBLIC_SUPABASE_URL);
    assert.equal(init.headers.apikey, env.DODO_PREVIEW_SUPABASE_SECRET_KEY);
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.cache, "no-store");
    if (init.method === "POST") {
      const data = JSON.parse(init.body);
      if (records.some(r => r.content_hash === data.content_hash)) return Response.json({}, {status:409});
      const row = { ...data, id: "11111111-1111-4111-8111-111111111111", created_at: "2026-10-11T16:00:00Z" };
      records.push(row); return Response.json([row], { status:201 });
    }
    const search = new URL(url).searchParams;
    return Response.json(records.filter(row => (!search.has("id") || search.get("id") === `eq.${row.id}`) &&
      (!search.has("content_hash") || search.get("content_hash") === `eq.${row.content_hash}`)));
  };
  const deps = { authorize: async () => true, env, fetcher };
  const saved = await handleSharedImport(post(), deps);
  assert.equal(saved.status,200);
  assert.match(saved.headers.get("Cache-Control"), /no-store/);
  const savedData = await saved.json();
  assert.equal(savedData.draft.row_count,60);
  assert.equal((await (await handleSharedImport(post(), deps)).json()).alreadySaved,true);
  assert.equal(records.length,1);
  const listed = await handleSharedImport(new Request(`${origin}/api/import-drafts?month=2026-10`), deps);
  const items = (await listed.json()).drafts;
  assert.equal(items.length,1);
  assert.equal(items[0].workspace_text,undefined);
  const loaded = await handleSharedImport(new Request(`${origin}/api/import-drafts?id=${items[0].id}`), deps);
  assert.equal(loaded.status,200);
  const workspace = parseImportWorkspace(JSON.stringify((await loaded.json()).workspace));
  const batch = validateDodoImportBatch({ ...workspace, rows: parseDodoImportText(workspace.sourceText).rows });
  assert.equal(batch.canConfirm,true);
  assert.equal(summarizeDodoImportRows(batch.rows).guidePaymentYen,555000n);
  assert.equal(createDodoImportConfirmationCsv(batch).trimEnd().split("\r\n").length,61);
  records[0].workspace_text = records[0].workspace_text.replace("12000", "22000");
  assert.equal((await handleSharedImport(new Request(`${origin}/api/import-drafts?id=${items[0].id}`), deps)).status,409);
});

test("unauthorized and external-origin requests never access the privileged database", async () => {
  let accessed = 0;
  const fetcher = async () => { accessed++; throw new Error("must not access"); };
  assert.equal((await handleSharedImport(post(), { authorize:async()=>false, env, fetcher })).status,401);
  assert.equal((await handleSharedImport(post(text,"https://attacker.example"), { authorize:async()=>true, env, fetcher })).status,403);
  assert.equal(accessed,0);
});

test("preview config cannot select WARRANTY, Production or anon credentials", () => {
  assert.throws(()=>sharedImportConfig({...env, VERCEL_ENV:"production"}));
  assert.throws(()=>sharedImportConfig({...env, NEXT_PUBLIC_SUPABASE_URL:"https://warranty.supabase.co"}));
  assert.throws(()=>sharedImportConfig({...env, DODO_PREVIEW_SUPABASE_SECRET_KEY:"sb_publishable_test"}));
  assert.throws(()=>sharedImportConfig({...env, DODO_PREVIEW_SUPABASE_SECRET_KEY:undefined}));
});

test("tampered amounts, empty/duplicate rows, and oversized sources cannot be saved", async () => {
  let accessed = 0;
  for (const invalid of [text.replace("12000", "x"), text.replace("R1,", "R0,"), "{}", " ".repeat(MAX_SHARED_IMPORT_BYTES+1)]) {
    const response = await handleSharedImport(post(invalid), { authorize:async()=>true, env, fetcher:async()=>{accessed++; throw new Error();} });
    assert.equal(response.status,400);
  }
  assert.equal(accessed,0);
  assert.equal(draftFingerprint(validateSharedImport(text).canonical).length,64);
});

test("DB outage and absent configuration fail explicitly, never claim save success", async () => {
  assert.equal((await handleSharedImport(post(), {authorize:async()=>true, env:{}})).status,503);
  assert.equal((await handleSharedImport(post(), {authorize:async()=>true, env, fetcher:async()=>{throw new Error("secret should not leak");}})).status,503);
});

test("all monthly drafts remain reopenable beyond 20, with tied timestamps and concurrent new saves", async () => {
  const created_at = "2026-10-11T16:00:00.123456+00:00";
  const records = Array.from({length:45}, (_, i) => ({
    id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
    source_partner: "免税店", statement_month: "2026-10", row_count:60,
    created_at, workspace_text:text, content_hash:draftFingerprint(text),
  }));
  const originalIds = records.map(row => row.id).reverse();
  const fetcher = async (url) => {
    const q = new URL(url).searchParams;
    if (q.has("id")) return Response.json(records.filter(row => `eq.${row.id}` === q.get("id") &&
      (!q.has("statement_month") || `eq.${row.statement_month}` === q.get("statement_month"))));
    assert.equal(q.get("limit"), "21");
    assert.equal(q.get("order"), "created_at.desc,id.desc");
    assert.equal(q.get("statement_month"), "eq.2026-10");
    const filter = q.get("or");
    const before = filter?.match(/id\.lt\.([0-9a-f-]+)\)\)$/)?.[1];
    if (filter) assert.equal(filter, `(created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${before}))`);
    return Response.json(records.filter(row => row.statement_month === "2026-10" && (!before || row.id < before))
      .sort((a,b) => b.id.localeCompare(a.id)).slice(0,21));
  };
  const deps = {authorize:async()=>true, env, fetcher};
  const list = async before => {
    const response = await handleSharedImport(new Request(`${origin}/api/import-drafts?month=2026-10${before ? `&before=${before}` : ""}`), deps);
    assert.equal(response.status,200);
    return response.json();
  };
  const first = await list();
  assert.equal(first.drafts.length,20);
  // A new save inserted ahead of the cursor must not shift or repeat older pages.
  records.push({...records[0], id:"11111111-1111-4111-8111-000000000099"});
  const second = await list(first.nextCursor);
  const third = await list(second.nextCursor);
  assert.equal(second.drafts.length,20);
  assert.equal(third.drafts.length,5);
  assert.equal(third.nextCursor,null);
  assert.deepEqual([...first.drafts,...second.drafts,...third.drafts].map(row=>row.id), originalIds);
  const reopened = await handleSharedImport(new Request(`${origin}/api/import-drafts?id=${third.drafts[4].id}`), deps);
  assert.equal(reopened.status,200);
  const {workspace} = await reopened.json();
  const batch = validateDodoImportBatch({...workspace, rows:parseDodoImportText(workspace.sourceText).rows});
  assert.equal(summarizeDodoImportRows(batch.rows).guidePaymentYen,555000n);
  assert.equal(createDodoImportConfirmationCsv(batch).trimEnd().split("\r\n").length,61);
});

test("invalid, missing or other-month pagination anchors never broaden the monthly listing", async () => {
  let reads = 0;
  const deps = {authorize:async()=>true, env, fetcher:async()=>{reads++; return Response.json([]);}};
  const request = query => new Request(`${origin}/api/import-drafts?${query}`);
  assert.equal((await handleSharedImport(request("month=2026-10&before=bad"), deps)).status,400);
  assert.equal(reads,0);
  assert.equal((await handleSharedImport(request("month=2026-10&before=11111111-1111-4111-8111-111111111111"), deps)).status,409);
  assert.equal(reads,1);
  const otherMonth = {...deps, fetcher:async()=>Response.json([{
    id:"11111111-1111-4111-8111-111111111111", source_partner:"別月", statement_month:"2026-09", row_count:1, created_at:"2026-09-01T00:00:00Z",
  }])};
  assert.equal((await handleSharedImport(request("month=2026-10&before=11111111-1111-4111-8111-111111111111"), otherMonth)).status,409);
});
