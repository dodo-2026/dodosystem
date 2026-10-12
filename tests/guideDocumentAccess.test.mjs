import assert from "node:assert/strict";
import test from "node:test";
import {
  createGuideDocumentDownload,
  listGuideDocuments,
} from "../lib/server/guideDocumentAccess.ts";

const guideA = "123e4567-e89b-42d3-a456-426614174000";
const guideB = "223e4567-e89b-42d3-a456-426614174000";
const settlementId = "323e4567-e89b-42d3-a456-426614174000";
const receiptId = "423e4567-e89b-42d3-a456-426614174000";
const base = {
  documentId: settlementId, guideId: guideA, kind: "settlement", period: "2026-10",
  status: "final", storageKey: "guide/a/2026-10/settlement.pdf",
};
const asGuideA = async () => guideA;

test("lists only final own document metadata", async () => {
  const records = await listGuideDocuments({
    sessionToken: "signed", verifySession: asGuideA, now: 1_000,
    listDocuments: async (requestedGuideId) => {
      assert.equal(requestedGuideId, guideA);
      return [base, { ...base, documentId: receiptId, kind: "receipt", status: "draft" },
        { ...base, documentId: "523e4567-e89b-42d3-a456-426614174000", guideId: guideB }];
    },
  });
  assert.deepEqual(records, [{ documentId: settlementId, kind: "settlement", period: "2026-10" }]);
  assert.equal(JSON.stringify(records).includes("storageKey"), false);
  assert.equal(Object.isFrozen(records), true);
});

test("missing or invalid guide session returns no document metadata", async () => {
  let calls = 0;
  for (const token of [undefined, "tampered"]) {
    assert.deepEqual(await listGuideDocuments({
      sessionToken: token, verifySession: async () => null,
      listDocuments: async () => { calls += 1; return [base]; }, now: 1_000,
    }), []);
  }
  assert.equal(calls, 0);
});

test("issues a 60-second storage URL only for the final document owner", async () => {
  let signerInput;
  const result = await createGuideDocumentDownload({
    sessionToken: "signed", documentId: settlementId, verifySession: asGuideA, now: 1_000,
    loadDocument: async (id) => { assert.equal(id, settlementId); return base; },
    createSignedDownload: async (input) => {
      signerInput = input;
      return "https://storage.example.test/signed-token";
    },
  });
  assert.deepEqual(result, { available: true, url: "https://storage.example.test/signed-token", expiresAt: 1_060 });
  assert.deepEqual(signerInput, { storageKey: base.storageKey, expiresAt: 1_060 });
  assert.equal(JSON.stringify(result).includes("storageKey"), false);
});

test("never loads invalid IDs or signs missing, foreign, draft or void documents", async () => {
  let signs = 0;
  const denied = async (documentId, record) => {
    const result = await createGuideDocumentDownload({
      sessionToken: "signed", documentId, verifySession: asGuideA, now: 1_000,
      loadDocument: async () => record,
      createSignedDownload: async () => { signs += 1; return "https://should-not-run"; },
    });
    assert.deepEqual(result, { available: false });
  };
  await denied("not-an-id", base);
  await denied(settlementId, null);
  await denied(settlementId, { ...base, guideId: guideB });
  await denied(settlementId, { ...base, status: "draft" });
  await denied(settlementId, { ...base, status: "void" });
  assert.equal(signs, 0);
});

test("fails closed when a loaded document or signed URL is malformed", async () => {
  await assert.rejects(createGuideDocumentDownload({
    sessionToken: "signed", documentId: settlementId, verifySession: asGuideA,
    loadDocument: async () => ({ ...base, storageKey: "" }),
    createSignedDownload: async () => "https://unused",
  }), /malformed/);
  await assert.rejects(createGuideDocumentDownload({
    sessionToken: "signed", documentId: settlementId, verifySession: asGuideA,
    loadDocument: async () => base,
    createSignedDownload: async () => "relative-url",
  }), /invalid signed/);
});
