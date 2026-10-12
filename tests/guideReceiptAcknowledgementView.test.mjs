import assert from "node:assert/strict";
import test from "node:test";

import { createGuideReceiptAcknowledgementView } from "../lib/dodo/guideReceiptAcknowledgementView.ts";

test("shows a pending receipt as actionable", () => {
  assert.deepEqual(createGuideReceiptAcknowledgementView({ status: "pending", acknowledgedAt: null }), {
    status: "pending",
    label: "未確認",
    detail: "ガイド本人の確認待ち",
    canAcknowledge: true,
  });
});

test("shows an acknowledged receipt with a deterministic Japan timestamp", () => {
  const timestamp = Date.UTC(2026, 9, 3, 1, 5) / 1_000;
  assert.deepEqual(createGuideReceiptAcknowledgementView({ status: "acknowledged", acknowledgedAt: timestamp }), {
    status: "acknowledged",
    label: "確認済み",
    detail: "2026年10月3日 10:05に確認",
    canAcknowledge: false,
  });
});

test("shows a void receipt as non-actionable", () => {
  assert.deepEqual(createGuideReceiptAcknowledgementView({ status: "void", acknowledgedAt: null }), {
    status: "void",
    label: "取消済み",
    detail: "この受取書は無効です",
    canAcknowledge: false,
  });
});

test("rejects inconsistent acknowledgement states", () => {
  assert.throws(
    () => createGuideReceiptAcknowledgementView({ status: "pending", acknowledgedAt: 1 }),
    /inconsistent/
  );
  assert.throws(
    () => createGuideReceiptAcknowledgementView({ status: "acknowledged", acknowledgedAt: null }),
    /inconsistent/
  );
  assert.throws(
    () => createGuideReceiptAcknowledgementView({ status: "void", acknowledgedAt: 1 }),
    /inconsistent/
  );
});
