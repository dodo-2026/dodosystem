import assert from "node:assert/strict";
import test from "node:test";

import { classifyGuideDocumentReadyNotificationAttentionTransition } from "../lib/server/guideDocumentReadyNotificationAttentionTransition.ts";

function attention(level, reason) {
  return { schemaVersion: 1, level, reason };
}

const healthy = () => attention("none", "healthy");
const delayed = () => attention("review", "admission_delayed");
const retry = () => attention("review", "retry_pending");
const cycleFailed = () => attention("action_required", "cycle_failed");
const loadFailed = () => attention("action_required", "load_failed");

test("suppresses an initially healthy state", () => {
  const result = classifyGuideDocumentReadyNotificationAttentionTransition(null, healthy());
  assert.deepEqual(result, {
    schemaVersion: 1,
    signal: "suppressed",
    attention: healthy(),
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.attention), true);
});

test("opens an initial state that needs review", () => {
  assert.deepEqual(
    classifyGuideDocumentReadyNotificationAttentionTransition(null, delayed()),
    { schemaVersion: 1, signal: "opened", attention: delayed() }
  );
});

test("suppresses an unchanged level and reason", () => {
  assert.deepEqual(
    classifyGuideDocumentReadyNotificationAttentionTransition(retry(), retry()),
    { schemaVersion: 1, signal: "suppressed", attention: retry() }
  );
});

test("opens attention when a healthy state becomes review or action", () => {
  for (const current of [delayed(), cycleFailed()]) {
    assert.equal(
      classifyGuideDocumentReadyNotificationAttentionTransition(healthy(), current).signal,
      "opened"
    );
  }
});

test("preserves escalation from review to action", () => {
  assert.deepEqual(
    classifyGuideDocumentReadyNotificationAttentionTransition(retry(), cycleFailed()),
    { schemaVersion: 1, signal: "escalated", attention: cycleFailed() }
  );
});

test("preserves de-escalation and full recovery", () => {
  assert.equal(
    classifyGuideDocumentReadyNotificationAttentionTransition(cycleFailed(), delayed()).signal,
    "deescalated"
  );
  assert.deepEqual(
    classifyGuideDocumentReadyNotificationAttentionTransition(cycleFailed(), healthy()),
    { schemaVersion: 1, signal: "recovered", attention: healthy() }
  );
});

test("preserves a reason change within one attention level", () => {
  assert.equal(
    classifyGuideDocumentReadyNotificationAttentionTransition(delayed(), retry()).signal,
    "changed"
  );
  assert.equal(
    classifyGuideDocumentReadyNotificationAttentionTransition(cycleFailed(), loadFailed()).signal,
    "changed"
  );
});

test("fails closed on malformed, expanded, inconsistent, and hostile snapshots", () => {
  const hostile = Object.create(null, {
    level: {
      enumerable: true,
      get() { throw new Error("private state detail"); },
    },
  });
  for (const [previous, current] of [
    [attention("review", "cycle_failed"), healthy()],
    [{ ...healthy(), count: 7 }, healthy()],
    [null, { ...healthy(), privateId: "secret" }],
    [null, hostile],
  ]) {
    const result = classifyGuideDocumentReadyNotificationAttentionTransition(previous, current);
    assert.deepEqual(result, {
      schemaVersion: 1,
      signal: "opened",
      attention: {
        schemaVersion: 1,
        level: "action_required",
        reason: "invalid_summary",
      },
    });
    assert.doesNotMatch(JSON.stringify(result), /private|secret|count|detail/);
  }
});
