import assert from "node:assert/strict";
import test from "node:test";

import { preparePersistedGuideDocumentReadyNotification } from "../lib/server/guideDocumentReadyNotificationService.ts";

const guideA = "123e4567-e89b-42d3-a456-426614174000";
const guideB = "223e4567-e89b-42d3-a456-426614174000";
const documentId = "323e4567-e89b-42d3-a456-426614174000";
const document = {
  documentId,
  guideId: guideA,
  documentStatus: "final",
  version: 1,
  contentFingerprint: "a".repeat(64),
};

test("verifies the session before loading and atomically claiming the exact document", async () => {
  const calls = [];
  const result = await preparePersistedGuideDocumentReadyNotification({
    sessionToken: "signed-session",
    documentId: documentId.toUpperCase(),
    verifySession: async (token) => {
      calls.push(["verify", token]);
      return guideA.toUpperCase();
    },
    loadDocument: async (id) => {
      calls.push(["load", id]);
      return { ...document, documentId: documentId.toUpperCase() };
    },
    claimIdempotencyKey: async (claim) => {
      calls.push(["claim", claim.documentId, claim.guideId]);
      return true;
    },
  });

  assert.equal(result.allowed, true);
  assert.deepEqual(calls, [
    ["verify", "signed-session"],
    ["load", documentId],
    ["claim", documentId, guideA],
  ]);
});

test("does not verify, load, or claim a malformed document identifier", async () => {
  let calls = 0;
  const result = await preparePersistedGuideDocumentReadyNotification({
    sessionToken: "signed-session",
    documentId: "not-a-document-id",
    verifySession: async () => { calls += 1; return guideA; },
    loadDocument: async () => { calls += 1; return document; },
    claimIdempotencyKey: async () => { calls += 1; return true; },
  });
  assert.deepEqual(result, { allowed: false });
  assert.equal(calls, 0);
});

test("does not load or claim without a verified guide session", async () => {
  let loads = 0;
  let claims = 0;
  const result = await preparePersistedGuideDocumentReadyNotification({
    sessionToken: "invalid-session",
    documentId,
    verifySession: async () => null,
    loadDocument: async () => { loads += 1; return document; },
    claimIdempotencyKey: async () => { claims += 1; return true; },
  });
  assert.deepEqual(result, { allowed: false });
  assert.equal(loads, 0);
  assert.equal(claims, 0);
});

test("denies missing, mismatched, foreign, draft, and void documents without a claim", async () => {
  let claims = 0;
  const records = [
    null,
    { ...document, documentId: "423e4567-e89b-42d3-a456-426614174000" },
    { ...document, guideId: guideB },
    { ...document, documentStatus: "draft" },
    { ...document, documentStatus: "void" },
  ];
  for (const record of records) {
    const result = await preparePersistedGuideDocumentReadyNotification({
      sessionToken: "signed-session",
      documentId,
      verifySession: async () => guideA,
      loadDocument: async () => record,
      claimIdempotencyKey: async () => { claims += 1; return true; },
    });
    assert.deepEqual(result, { allowed: false });
  }
  assert.equal(claims, 0);
});

test("contains private dependency failures behind one fixed result", async () => {
  const events = [];
  for (const dependencies of [
    { verifySession: async () => { throw new Error("secret token"); }, loadDocument: async () => document, claimIdempotencyKey: async () => true },
    { verifySession: async () => guideA, loadDocument: async () => { throw new Error("private row"); }, claimIdempotencyKey: async () => true },
    { verifySession: async () => guideA, loadDocument: async () => document, claimIdempotencyKey: async () => { throw new Error("provider detail"); } },
  ]) {
    const result = await preparePersistedGuideDocumentReadyNotification({
      sessionToken: "signed-session",
      documentId,
      ...dependencies,
      onPrivateError: (event) => {
        events.push(event);
        throw new Error("monitor unavailable");
      },
    });
    assert.deepEqual(result, { allowed: false });
  }
  assert.deepEqual(events, Array(3).fill("guide_document_ready_notification_failed"));
});
