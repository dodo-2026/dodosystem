import assert from "node:assert/strict";
import test from "node:test";

import { observeGuideDocumentReadyNotificationAttention } from "../lib/server/guideDocumentReadyNotificationAttentionObserver.ts";

function counts(overrides = {}) {
  return {
    candidates: 0,
    attempted: 0,
    delivered: 0,
    temporaryFailures: 0,
    permanentFailures: 0,
    leasesRecovered: 0,
    skipped: 0,
    persistenceUncertain: 0,
    privateFailures: 0,
    ...overrides,
  };
}

function processed(overrides = {}) {
  return {
    schemaVersion: 1,
    admission: "executed",
    release: "confirmed",
    batch: "processed",
    counts: counts(),
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    summary: processed(),
    observeAttention: () => {},
    ...overrides,
  };
}

test("gives observers only an immutable fixed attention state", async () => {
  let observed;
  const attention = await observeGuideDocumentReadyNotificationAttention(input({
    observeAttention: (value) => { observed = value; },
  }));
  assert.equal(observed, attention);
  assert.deepEqual(attention, {
    schemaVersion: 1,
    level: "none",
    reason: "healthy",
  });
  assert.equal(Object.isFrozen(attention), true);
  assert.deepEqual(Object.keys(attention).sort(), ["level", "reason", "schemaVersion"]);
  assert.doesNotMatch(JSON.stringify(attention), /counts|candidates|attempted|delivered/);
});

test("passes a bounded action state without summary details", async () => {
  let observed;
  const attention = await observeGuideDocumentReadyNotificationAttention(input({
    summary: processed({
      counts: counts({ candidates: 1, attempted: 1, permanentFailures: 1 }),
    }),
    observeAttention: (value) => { observed = value; },
  }));
  assert.equal(observed, attention);
  assert.deepEqual(attention, {
    schemaVersion: 1,
    level: "action_required",
    reason: "permanent_failures",
  });
  assert.doesNotMatch(JSON.stringify(attention), /counts|candidates|attempted/);
});

test("fails closed before observing an expanded summary", async () => {
  let observed;
  const attention = await observeGuideDocumentReadyNotificationAttention(input({
    summary: processed({ recipient: "private-recipient" }),
    observeAttention: (value) => { observed = value; },
  }));
  assert.equal(observed, attention);
  assert.deepEqual(attention, {
    schemaVersion: 1,
    level: "action_required",
    reason: "invalid_summary",
  });
  assert.doesNotMatch(JSON.stringify(attention), /private|recipient/);
});

test("contains a hostile summary accessor", async () => {
  let observed;
  let privateFailures = 0;
  const hostile = input({
    observeAttention: (value) => { observed = value; },
    onPrivateError: () => { privateFailures += 1; },
  });
  Object.defineProperty(hostile, "summary", {
    enumerable: true,
    get() { throw new Error("private summary getter"); },
  });
  const attention = await observeGuideDocumentReadyNotificationAttention(hostile);
  assert.equal(observed, attention);
  assert.equal(privateFailures, 1);
  assert.equal(attention.reason, "invalid_summary");
  assert.doesNotMatch(JSON.stringify(attention), /private|getter/);
});

test("contains a synchronous observer exception", async () => {
  let privateFailures = 0;
  const attention = await observeGuideDocumentReadyNotificationAttention(input({
    observeAttention: () => { throw new Error("private observer detail"); },
    onPrivateError: () => { privateFailures += 1; },
  }));
  assert.equal(attention.reason, "healthy");
  assert.equal(privateFailures, 1);
});

test("contains a rejected asynchronous observer", async () => {
  let privateFailures = 0;
  const attention = await observeGuideDocumentReadyNotificationAttention(input({
    observeAttention: async () => { throw new Error("private async detail"); },
    onPrivateError: () => { privateFailures += 1; },
  }));
  assert.equal(attention.reason, "healthy");
  assert.equal(privateFailures, 1);
});

test("contains a failing private-error reporter", async () => {
  const attention = await observeGuideDocumentReadyNotificationAttention(input({
    observeAttention: () => { throw new Error("private observer detail"); },
    onPrivateError: () => { throw new Error("private reporter detail"); },
  }));
  assert.equal(attention.reason, "healthy");
  assert.doesNotMatch(JSON.stringify(attention), /observer|reporter|detail/);
});

test("contains hostile monitoring accessors", async () => {
  const hostile = input();
  Object.defineProperties(hostile, {
    observeAttention: {
      enumerable: true,
      get() { throw new Error("private observer getter"); },
    },
    onPrivateError: {
      enumerable: true,
      get() { throw new Error("private reporter getter"); },
    },
  });
  const attention = await observeGuideDocumentReadyNotificationAttention(hostile);
  assert.equal(attention.reason, "healthy");
  assert.doesNotMatch(JSON.stringify(attention), /observer|reporter|getter/);
});
