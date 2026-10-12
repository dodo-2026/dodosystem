import assert from "node:assert/strict";
import test from "node:test";

import { dispatchGuideDocumentReadyNotification } from "../lib/server/guideDocumentReadyNotificationDispatch.ts";
import { resolveGuideDocumentNotificationRecipient } from "../lib/server/guideDocumentNotificationRecipientResolver.ts";

const idempotencyKey = `guide-document-ready:${"a".repeat(64)}`;
const guideId = "123e4567-e89b-42d3-a456-426614174000";
const otherGuideId = "223e4567-e89b-42d3-a456-426614174000";
const documentId = "323e4567-e89b-42d3-a456-426614174000";
const recipient = Object.freeze({ kind: "provider-user-v1", handle: "guide_user_123" });
const binding = Object.freeze({ idempotencyKey, documentId, guideId, documentVersion: 3 });
const document = Object.freeze({ documentId, guideId, version: 3, status: "final" });
const recipientRecord = Object.freeze({ guideId, status: "active", recipient });

function dependencies(overrides = {}) {
  return {
    loadBinding: async () => binding,
    loadDocument: async () => document,
    loadRecipient: async () => recipientRecord,
    ...overrides,
  };
}

test("resolves a frozen private recipient only after exact ownership checks", async () => {
  const calls = [];
  const result = await resolveGuideDocumentNotificationRecipient({
    idempotencyKey,
    loadBinding: async (key) => {
      calls.push(["binding", key]);
      return { ...binding, documentId: documentId.toUpperCase(), guideId: guideId.toUpperCase() };
    },
    loadDocument: async (id) => {
      calls.push(["document", id]);
      return { ...document, documentId: documentId.toUpperCase(), guideId: guideId.toUpperCase() };
    },
    loadRecipient: async (id) => {
      calls.push(["recipient", id]);
      return { ...recipientRecord, guideId: guideId.toUpperCase() };
    },
  });

  assert.deepEqual(calls, [
    ["binding", idempotencyKey],
    ["document", documentId],
    ["recipient", guideId],
  ]);
  assert.deepEqual(result, { resolved: true, recipient });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.recipient), true);
});

test("rejects malformed request keys before any private read", async () => {
  let reads = 0;
  const result = await resolveGuideDocumentNotificationRecipient({
    idempotencyKey: "bad-key",
    ...dependencies({
      loadBinding: async () => { reads += 1; return binding; },
      loadDocument: async () => { reads += 1; return document; },
      loadRecipient: async () => { reads += 1; return recipientRecord; },
    }),
  });
  assert.deepEqual(result, { resolved: false });
  assert.equal(reads, 0);
});

test("stops on a missing binding without loading document or recipient", async () => {
  let laterReads = 0;
  const result = await resolveGuideDocumentNotificationRecipient({
    idempotencyKey,
    ...dependencies({
      loadBinding: async () => null,
      loadDocument: async () => { laterReads += 1; return document; },
      loadRecipient: async () => { laterReads += 1; return recipientRecord; },
    }),
  });
  assert.deepEqual(result, { resolved: false });
  assert.equal(laterReads, 0);
});

test("rejects mismatched or expanded bindings before later reads", async () => {
  const values = [
    { ...binding, idempotencyKey: `guide-document-ready:${"b".repeat(64)}` },
    { ...binding, extra: "private" },
    { ...binding, documentVersion: 0 },
  ];
  for (const value of values) {
    let laterReads = 0;
    const result = await resolveGuideDocumentNotificationRecipient({
      idempotencyKey,
      ...dependencies({
        loadBinding: async () => value,
        loadDocument: async () => { laterReads += 1; return document; },
        loadRecipient: async () => { laterReads += 1; return recipientRecord; },
      }),
    });
    assert.deepEqual(result, { resolved: false });
    assert.equal(laterReads, 0);
  }
});

test("requires the exact final owned document before reading the recipient", async () => {
  const values = [
    null,
    { ...document, documentId: "423e4567-e89b-42d3-a456-426614174000" },
    { ...document, guideId: otherGuideId },
    { ...document, version: 4 },
    { ...document, status: "draft" },
    { ...document, status: "void" },
    { ...document, extra: "private" },
  ];
  for (const value of values) {
    let recipientReads = 0;
    const result = await resolveGuideDocumentNotificationRecipient({
      idempotencyKey,
      ...dependencies({
        loadDocument: async () => value,
        loadRecipient: async () => { recipientReads += 1; return recipientRecord; },
      }),
    });
    assert.deepEqual(result, { resolved: false });
    assert.equal(recipientReads, 0);
  }
});

test("rejects unavailable, foreign, disabled, or malformed recipients", async () => {
  const values = [
    null,
    { ...recipientRecord, guideId: otherGuideId },
    { ...recipientRecord, status: "disabled" },
    { ...recipientRecord, recipient: { ...recipient, handle: "bad handle" } },
    { ...recipientRecord, extra: "private" },
  ];
  for (const value of values) {
    const result = await resolveGuideDocumentNotificationRecipient({
      idempotencyKey,
      ...dependencies({ loadRecipient: async () => value }),
    });
    assert.deepEqual(result, { resolved: false });
    assert.equal(JSON.stringify(result).includes("guide_user"), false);
  }
});

test("contains reader and observer failures behind one fixed result", async () => {
  const events = [];
  for (const overrides of [
    { loadBinding: async () => { throw new Error("private binding"); } },
    { loadDocument: async () => { throw new Error("private document"); } },
    { loadRecipient: async () => { throw new Error("private recipient"); } },
  ]) {
    const result = await resolveGuideDocumentNotificationRecipient({
      idempotencyKey,
      ...dependencies(overrides),
      onPrivateError: () => {
        events.push("failed");
        throw new Error("observer unavailable");
      },
    });
    assert.deepEqual(result, { resolved: false });
    assert.doesNotMatch(JSON.stringify(result), /private|binding|recipient|document/);
  }
  assert.deepEqual(events, ["failed", "failed", "failed"]);
});

test("unresolved ownership never reaches the provider adapter", async () => {
  let adapterCalls = 0;
  const resolution = await resolveGuideDocumentNotificationRecipient({
    idempotencyKey,
    ...dependencies({ loadDocument: async () => ({ ...document, guideId: otherGuideId }) }),
  });
  if (resolution.resolved) {
    await dispatchGuideDocumentReadyNotification({
      recipient: resolution.recipient,
      request: {
        idempotencyKey,
        payload: {
          schemaVersion: 1,
          event: "guide.document-ready",
          title: "書類の準備ができました",
          body: "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。",
          actionLabel: "DODOで確認する",
        },
      },
      adapter: {
        getCapabilities: async () => {
          adapterCalls += 1;
          return { idempotencyMode: "provider-key-v1", requestSchemaVersion: 1 };
        },
        send: async () => {
          adapterCalls += 1;
          return { outcome: "delivered" };
        },
      },
    });
  }
  assert.deepEqual(resolution, { resolved: false });
  assert.equal(adapterCalls, 0);
});
