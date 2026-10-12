import assert from "node:assert/strict";
import test from "node:test";

import { createGuideReceiptStatePreviews } from "../lib/dodo/guideReceiptStatePreviews.ts";

test("builds the four immutable receipt states required for local UI review", () => {
  const states = createGuideReceiptStatePreviews();
  assert.deepEqual(states.map((state) => state.key), [
    "pending",
    "acknowledged",
    "retryable_error",
    "void",
  ]);
  assert.equal(Object.isFrozen(states), true);
  for (const state of states) assert.equal(Object.isFrozen(state), true);
});

test("exposes only public display state and no request or credential material", () => {
  const serialized = JSON.stringify(createGuideReceiptStatePreviews());
  assert.deepEqual(createGuideReceiptStatePreviews().map((state) => state.requestEnabled), [
    false,
    false,
    false,
    false,
  ]);
  assert.doesNotMatch(serialized, /submissionId|documentId|cookie|token|secret|url/i);
});
