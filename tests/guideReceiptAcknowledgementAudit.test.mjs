import assert from "node:assert/strict";
import test from "node:test";

import {
  createGuideReceiptAcknowledgementAuditRecord,
  fingerprintGuideReceiptAcknowledgementAuditRecord,
  verifyGuideReceiptAcknowledgementAuditFingerprint,
} from "../lib/server/guideReceiptAcknowledgementAudit.ts";

const guideId = "123e4567-e89b-42d3-a456-426614174000";
const documentId = "323e4567-e89b-42d3-a456-426614174000";
const eventId = "423e4567-e89b-42d3-a456-426614174000";
const previous = Object.freeze({
  documentId,
  guideId,
  documentStatus: "final",
  acknowledgementStatus: "pending",
  receiptFingerprint: "a".repeat(64),
  acknowledgedAt: null,
});
const next = Object.freeze({
  ...previous,
  acknowledgementStatus: "acknowledged",
  acknowledgedAt: 1_000,
});

test("creates an immutable audit record for the exact receipt transition", () => {
  const record = createGuideReceiptAcknowledgementAuditRecord({ eventId, previous, next });
  assert.deepEqual(record, {
    schemaVersion: 1,
    eventKind: "receipt_acknowledged",
    eventId,
    documentId,
    guideId,
    receiptFingerprint: "a".repeat(64),
    acknowledgedAt: 1_000,
  });
  assert.equal(Object.isFrozen(record), true);
});

test("rejects any state change other than one matching pending-to-acknowledged transition", () => {
  for (const input of [
    { previous: { ...previous, documentStatus: "draft" }, next },
    { previous, next: { ...next, documentId: "523e4567-e89b-42d3-a456-426614174000" } },
    { previous, next: { ...next, guideId: "223e4567-e89b-42d3-a456-426614174000" } },
    { previous, next: { ...next, receiptFingerprint: "b".repeat(64) } },
    { previous, next: { ...previous } },
  ]) {
    assert.throws(
      () => createGuideReceiptAcknowledgementAuditRecord({ eventId, ...input }),
      /transition/
    );
  }
});

test("fingerprints the canonical audit record deterministically", async () => {
  const record = createGuideReceiptAcknowledgementAuditRecord({ eventId, previous, next });
  const first = await fingerprintGuideReceiptAcknowledgementAuditRecord(record);
  const second = await fingerprintGuideReceiptAcknowledgementAuditRecord(record);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(second, first);
  assert.equal(
    await verifyGuideReceiptAcknowledgementAuditFingerprint(record, first),
    true
  );
});

test("detects a changed timestamp or receipt fingerprint", async () => {
  const record = createGuideReceiptAcknowledgementAuditRecord({ eventId, previous, next });
  const fingerprint = await fingerprintGuideReceiptAcknowledgementAuditRecord(record);
  assert.equal(
    await verifyGuideReceiptAcknowledgementAuditFingerprint(
      { ...record, acknowledgedAt: 1_001 },
      fingerprint
    ),
    false
  );
  assert.equal(
    await verifyGuideReceiptAcknowledgementAuditFingerprint(
      { ...record, receiptFingerprint: "b".repeat(64) },
      fingerprint
    ),
    false
  );
});

test("keeps the audit record minimal and rejects hidden extra fields", async () => {
  const record = createGuideReceiptAcknowledgementAuditRecord({ eventId, previous, next });
  assert.deepEqual(Object.keys(record), [
    "schemaVersion",
    "eventKind",
    "eventId",
    "documentId",
    "guideId",
    "receiptFingerprint",
    "acknowledgedAt",
  ]);
  assert.doesNotMatch(
    JSON.stringify(record),
    /cookie|token|phone|user-agent|ip-address|electronic-signature/i
  );
  await assert.rejects(
    fingerprintGuideReceiptAcknowledgementAuditRecord({ ...record, token: "secret" }),
    /malformed/
  );
});
