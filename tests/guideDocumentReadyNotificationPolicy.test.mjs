import assert from "node:assert/strict";
import test from "node:test";

import { prepareGuideDocumentReadyNotification } from "../lib/server/guideDocumentReadyNotificationPolicy.ts";

const guideA = "123e4567-e89b-42d3-a456-426614174000";
const guideB = "223e4567-e89b-42d3-a456-426614174000";
const document = {
  documentId: "323e4567-e89b-42d3-a456-426614174000",
  guideId: guideA,
  documentStatus: "final",
  version: 2,
  contentFingerprint: "a".repeat(64),
};

test("prepares only the fixed public payload after an atomic claim", async () => {
  const claims = [];
  const result = await prepareGuideDocumentReadyNotification({
    verifiedGuideId: guideA,
    document,
    claimIdempotencyKey: async (claim) => {
      claims.push(claim);
      return true;
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.payload), true);
  assert.deepEqual(Object.keys(result.payload).sort(), [
    "actionLabel",
    "body",
    "event",
    "schemaVersion",
    "title",
  ]);
  assert.match(result.idempotencyKey, /^guide-document-ready:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(claims[0]), true);
  assert.equal(claims[0].idempotencyKey, result.idempotencyKey);

  const publicPayload = JSON.stringify(result.payload);
  assert.doesNotMatch(publicPayload, /https?:|signed|token|cookie|session|pdf|uuid|口座番号/i);
  assert.doesNotMatch(publicPayload, /123e4567|323e4567|¥|￥|\b\d{6}\b/);
});

test("returns the same denial without claiming for unauthenticated, foreign, or non-final input", async () => {
  let claims = 0;
  for (const input of [
    { verifiedGuideId: null, document },
    { verifiedGuideId: guideB, document },
    { verifiedGuideId: guideA, document: { ...document, documentStatus: "draft" } },
    { verifiedGuideId: guideA, document: { ...document, documentStatus: "void" } },
  ]) {
    const result = await prepareGuideDocumentReadyNotification({
      ...input,
      claimIdempotencyKey: async () => {
        claims += 1;
        return true;
      },
    });
    assert.deepEqual(result, { allowed: false });
  }
  assert.equal(claims, 0);
});

test("denies a replay when the idempotency claim already exists", async () => {
  const keys = new Set();
  const claimIdempotencyKey = async ({ idempotencyKey }) => {
    if (keys.has(idempotencyKey)) return false;
    keys.add(idempotencyKey);
    return true;
  };

  const first = await prepareGuideDocumentReadyNotification({
    verifiedGuideId: guideA,
    document,
    claimIdempotencyKey,
  });
  const replay = await prepareGuideDocumentReadyNotification({
    verifiedGuideId: guideA,
    document,
    claimIdempotencyKey,
  });
  assert.equal(first.allowed, true);
  assert.deepEqual(replay, { allowed: false });
});

test("fails closed when the injected claim does not return a boolean", async () => {
  const result = await prepareGuideDocumentReadyNotification({
    verifiedGuideId: guideA,
    document,
    claimIdempotencyKey: async () => "accepted",
  });
  assert.deepEqual(result, { allowed: false });
});

test("changes the idempotency key when the immutable document revision changes", async () => {
  const keys = [];
  for (const revision of [document, { ...document, version: 3, contentFingerprint: "b".repeat(64) }]) {
    const result = await prepareGuideDocumentReadyNotification({
      verifiedGuideId: guideA,
      document: revision,
      claimIdempotencyKey: async ({ idempotencyKey }) => {
        keys.push(idempotencyKey);
        return true;
      },
    });
    assert.equal(result.allowed, true);
  }
  assert.notEqual(keys[0], keys[1]);
});
