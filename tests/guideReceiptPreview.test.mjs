import assert from "node:assert/strict";
import test from "node:test";

import { createGuideReceiptPreview } from "../lib/dodo/guideReceiptPreview.ts";

test("builds an immutable fictional receipt without persistence or notification", () => {
  const preview = createGuideReceiptPreview();
  assert.equal(preview.previewLabel, "架空データ・表示確認専用");
  assert.equal(preview.status, "pending");
  assert.equal(preview.persistenceEnabled, false);
  assert.equal(preview.notificationEnabled, false);
  assert.equal(Object.isFrozen(preview), true);
});

test("creates a fresh wrapper without changing deterministic fictional values", () => {
  const first = createGuideReceiptPreview();
  const second = createGuideReceiptPreview();
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  assert.doesNotMatch(JSON.stringify(first), /phone|cookie|token|storage|wechat/i);
});
