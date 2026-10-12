import assert from "node:assert/strict";
import test from "node:test";

import {
  beginGuideReceiptAcknowledgement,
  completeGuideReceiptAcknowledgement,
  createGuideReceiptAcknowledgementFormState,
} from "../lib/dodo/guideReceiptAcknowledgementForm.ts";

const firstId = "123e4567-e89b-42d3-a456-426614174000";
const secondId = "223e4567-e89b-42d3-a456-426614174000";

test("initializes pending, acknowledged, and void receipt states safely", () => {
  const acknowledgedAt = Date.UTC(2026, 5, 3, 1, 45) / 1_000;
  assert.deepEqual(
    createGuideReceiptAcknowledgementFormState({ status: "pending", acknowledgedAt: null }),
    { phase: "ready", message: "受取内容を確認してください", canSubmit: true }
  );
  assert.deepEqual(
    createGuideReceiptAcknowledgementFormState({ status: "acknowledged", acknowledgedAt }),
    { phase: "acknowledged", message: "2026年6月3日 10:45に確認", canSubmit: false }
  );
  assert.deepEqual(
    createGuideReceiptAcknowledgementFormState({ status: "void", acknowledgedAt: null }),
    {
      phase: "unavailable",
      message: "現在この受取書を確認できません。画面を再読み込みしてください",
      canSubmit: false,
    }
  );
});

test("starts one submission and blocks duplicate starts while pending", () => {
  const ready = createGuideReceiptAcknowledgementFormState({ status: "pending", acknowledgedAt: null });
  const submitting = beginGuideReceiptAcknowledgement(ready, firstId.toUpperCase());
  assert.deepEqual(submitting, {
    phase: "submitting",
    submissionId: firstId,
    message: "確認を記録しています",
    canSubmit: false,
  });
  assert.equal(beginGuideReceiptAcknowledgement(submitting, secondId), submitting);
});

test("maps a successful matching response to a final Japan-time message", () => {
  const ready = createGuideReceiptAcknowledgementFormState({ status: "pending", acknowledgedAt: null });
  const submitting = beginGuideReceiptAcknowledgement(ready, firstId);
  const timestamp = Date.UTC(2026, 9, 3, 1, 5) / 1_000;
  assert.deepEqual(
    completeGuideReceiptAcknowledgement(submitting, firstId, { ok: true, acknowledgedAt: timestamp }),
    { phase: "acknowledged", message: "2026年10月3日 10:05に確認", canSubmit: false }
  );
});

test("ignores stale responses with a different submission ID", () => {
  const ready = createGuideReceiptAcknowledgementFormState({ status: "pending", acknowledgedAt: null });
  const submitting = beginGuideReceiptAcknowledgement(ready, firstId);
  const result = completeGuideReceiptAcknowledgement(
    submitting,
    secondId,
    { ok: true, acknowledgedAt: 1_000 }
  );
  assert.equal(result, submitting);
});

test("allows retry only after a temporary failure", () => {
  const ready = createGuideReceiptAcknowledgementFormState({ status: "pending", acknowledgedAt: null });
  const submitting = beginGuideReceiptAcknowledgement(ready, firstId);
  const failed = completeGuideReceiptAcknowledgement(
    submitting,
    firstId,
    { ok: false, error: "temporarily_unavailable" }
  );
  assert.deepEqual(failed, {
    phase: "retryable_error",
    message: "確認を記録できませんでした。時間をおいて再度お試しください",
    canSubmit: true,
  });
  assert.equal(beginGuideReceiptAcknowledgement(failed, secondId).phase, "submitting");
});

test("uses one generic non-retryable message for invalid and unavailable results", () => {
  for (const error of ["invalid_request", "unavailable"]) {
    const ready = createGuideReceiptAcknowledgementFormState({ status: "pending", acknowledgedAt: null });
    const submitting = beginGuideReceiptAcknowledgement(ready, firstId);
    const result = completeGuideReceiptAcknowledgement(submitting, firstId, { ok: false, error });
    assert.deepEqual(result, {
      phase: "unavailable",
      message: "現在この受取書を確認できません。画面を再読み込みしてください",
      canSubmit: false,
    });
  }
});
