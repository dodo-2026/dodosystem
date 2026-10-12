import assert from "node:assert/strict";
import test from "node:test";

import { observeGuideDocumentReadyNotificationAttentionTransition } from "../lib/server/guideDocumentReadyNotificationAttentionTransitionObserver.ts";

function attention(level, reason) {
  return { schemaVersion: 1, level, reason };
}

const healthy = () => attention("none", "healthy");
const delayed = () => attention("review", "admission_delayed");
const retry = () => attention("review", "retry_pending");
const cycleFailed = () => attention("action_required", "cycle_failed");

function input(overrides = {}) {
  return {
    previous: null,
    current: healthy(),
    observeTransition: () => {},
    ...overrides,
  };
}

test("suppresses an initially healthy state without reading the observer", async () => {
  const source = input();
  Object.defineProperty(source, "observeTransition", {
    enumerable: true,
    get() { throw new Error("observer must stay unread"); },
  });
  const result = await observeGuideDocumentReadyNotificationAttentionTransition(source);
  assert.deepEqual(result, {
    schemaVersion: 1,
    signal: "suppressed",
    attention: healthy(),
  });
});

test("suppresses an unchanged state without invoking the observer", async () => {
  let observations = 0;
  const result = await observeGuideDocumentReadyNotificationAttentionTransition(input({
    previous: retry(),
    current: retry(),
    observeTransition: () => { observations += 1; },
  }));
  assert.equal(result.signal, "suppressed");
  assert.equal(observations, 0);
});

test("observes one immutable fixed opening transition", async () => {
  let observed;
  const result = await observeGuideDocumentReadyNotificationAttentionTransition(input({
    current: delayed(),
    observeTransition: (value) => { observed = value; },
  }));
  assert.equal(observed, result);
  assert.deepEqual(result, {
    schemaVersion: 1,
    signal: "opened",
    attention: delayed(),
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.attention), true);
  assert.deepEqual(Object.keys(result).sort(), ["attention", "schemaVersion", "signal"]);
});

test("observes escalation, de-escalation, and recovery", async () => {
  for (const [previous, current, signal] of [
    [retry(), cycleFailed(), "escalated"],
    [cycleFailed(), delayed(), "deescalated"],
    [cycleFailed(), healthy(), "recovered"],
  ]) {
    let observed;
    const result = await observeGuideDocumentReadyNotificationAttentionTransition(input({
      previous,
      current,
      observeTransition: (value) => { observed = value; },
    }));
    assert.equal(observed, result);
    assert.equal(result.signal, signal);
  }
});

test("observes a reason change within one level", async () => {
  let observations = 0;
  const result = await observeGuideDocumentReadyNotificationAttentionTransition(input({
    previous: delayed(),
    current: retry(),
    observeTransition: () => { observations += 1; },
  }));
  assert.equal(result.signal, "changed");
  assert.equal(observations, 1);
});

test("observes only a generic fail-closed transition for invalid input", async () => {
  let observed;
  const result = await observeGuideDocumentReadyNotificationAttentionTransition(input({
    current: { ...healthy(), privateRecipient: "secret" },
    observeTransition: (value) => { observed = value; },
  }));
  assert.equal(observed, result);
  assert.deepEqual(result, {
    schemaVersion: 1,
    signal: "opened",
    attention: {
      schemaVersion: 1,
      level: "action_required",
      reason: "invalid_summary",
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /private|recipient|secret/);
});

test("contains synchronous and asynchronous observer failures", async () => {
  for (const observeTransition of [
    () => { throw new Error("private sync detail"); },
    async () => { throw new Error("private async detail"); },
  ]) {
    let privateFailures = 0;
    const result = await observeGuideDocumentReadyNotificationAttentionTransition(input({
      current: delayed(),
      observeTransition,
      onPrivateError: () => { privateFailures += 1; },
    }));
    assert.equal(result.signal, "opened");
    assert.equal(privateFailures, 1);
    assert.doesNotMatch(JSON.stringify(result), /private|detail/);
  }
});

test("contains hostile accessors and a failing private-error reporter", async () => {
  const hostile = input({
    current: delayed(),
    onPrivateError: () => { throw new Error("private reporter detail"); },
  });
  Object.defineProperty(hostile, "observeTransition", {
    enumerable: true,
    get() { throw new Error("private observer getter"); },
  });
  const result = await observeGuideDocumentReadyNotificationAttentionTransition(hostile);
  assert.equal(result.signal, "opened");
  assert.equal(result.attention.reason, "admission_delayed");
  assert.doesNotMatch(JSON.stringify(result), /private|observer|reporter|getter|detail/);
});
