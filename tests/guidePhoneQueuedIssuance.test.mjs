import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  handleQueuedGuidePhoneIssuanceRequest,
  processQueuedGuidePhoneIssuance,
} from "../lib/server/guidePhoneQueuedIssuance.ts";
import { handleGuidePhoneVerificationRequest } from "../lib/server/guidePhoneVerificationHttp.ts";
import { verifyGuideSession } from "../lib/server/guideSession.ts";

const phone = "+819012345678";
const guideId = "123e4567-e89b-42d3-a456-426614174001";
const sourceKey = "trusted-edge-source-key-0001";
const names = ["GUIDE_PHONE_CODE_SECRET", "GUIDE_SESSION_SECRET"];
const previous = {};
beforeEach(() => {
  for (const name of names) {
    previous[name] = process.env[name];
    process.env[name] = "test-only-queued-auth-secret-32-characters-long";
  }
});
afterEach(() => {
  for (const name of names) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
});

test("intake returns before worker delivery and its receipt authenticates after processing", async () => {
  const jobs = [];
  const records = new Map();
  const deliveries = [];
  const response = await handleQueuedGuidePhoneIssuanceRequest({
    body: { phone }, sourceKey, now: 1_000,
    admit: async () => true,
    enqueue: async (job) => { jobs.push(job); },
  });
  assert.equal(response.status, 202);
  assert.equal(deliveries.length, 0);
  assert.equal(records.size, 0);
  assert.equal(jobs[0].challengeId, response.body.challengeId);
  assert.deepEqual(Object.keys(jobs[0]).sort(), ["challengeId", "enqueuedAt", "phone"]);
  assert.equal(Object.isFrozen(jobs[0]), true);
  const dependencies = {
    loadContext: async () => ({
      guideCandidates: [{ guideId, phoneE164: phone, isActive: true }], issuedAt: [],
    }),
    persistChallenge: async (record) => {
      if (records.has(record.challengeId)) return false;
      records.set(record.challengeId, structuredClone(record));
      return true;
    },
    sendCode: async (delivery) => {
      assert.equal(records.has(response.body.challengeId), true);
      deliveries.push(delivery);
    },
  };
  const issued = await processQueuedGuidePhoneIssuance({ job: jobs[0], now: 1_010, ...dependencies });
  assert.equal(issued.issued, true);
  assert.equal(issued.challengeId, response.body.challengeId);
  const replay = await processQueuedGuidePhoneIssuance({ job: jobs[0], now: 1_011, ...dependencies });
  assert.equal(replay.issued, false);
  assert.equal(deliveries.length, 1);
  const verified = await handleGuidePhoneVerificationRequest({
    body: { challengeId: response.body.challengeId, code: deliveries[0].code },
    now: 1_012,
    load: async (id) => records.get(id),
    commit: async ({ challengeId, nextState }) => {
      records.get(challengeId).state = nextState;
      return true;
    },
  });
  assert.equal(verified.status, 200);
  assert.equal(await verifyGuideSession(verified.cookie.value), guideId);
});

test("invalid public input never queues and cannot choose a receipt", async () => {
  for (const body of [{ phone, challengeId: crypto.randomUUID() }, { phone: "" }]) {
    const result = await handleQueuedGuidePhoneIssuanceRequest({
      body, sourceKey, admit: async () => assert.fail("must not admit"),
      enqueue: async () => assert.fail("must not queue"),
    });
    assert.equal(result.status, 400);
  }
});

test("queue failure returns only the uniform acknowledgement and fixed diagnostic", async () => {
  const events = [];
  const result = await handleQueuedGuidePhoneIssuanceRequest({
    body: { phone }, sourceKey, admit: async () => true,
    enqueue: async () => { throw new Error("private queue details " + phone); },
    onInternalFailure: (event) => events.push(event),
  });
  assert.equal(result.status, 202);
  assert.deepEqual(Object.keys(result.body).sort(), ["challengeId", "ok"]);
  assert.equal(JSON.stringify(result).includes(phone), false);
  assert.deepEqual(events, ["guide_phone_issuance_failed"]);
});

test("stale and future jobs never look up accounts, persist or send", async () => {
  const job = { phone, challengeId: crypto.randomUUID(), enqueuedAt: 1_000 };
  const dependencies = {
    loadContext: async () => assert.fail("must not look up"),
    persistChallenge: async () => assert.fail("must not persist"),
    sendCode: async () => assert.fail("must not send"),
  };
  assert.deepEqual(await processQueuedGuidePhoneIssuance({ job, now: 1_120, ...dependencies }),
    { issued: false, reason: "queue_expired" });
  await assert.rejects(processQueuedGuidePhoneIssuance({ job, now: 999, ...dependencies }), /Invalid queued/);
});

test("unregistered phone is acknowledged before the worker denies without delivery", async () => {
  let queued;
  const result = await handleQueuedGuidePhoneIssuanceRequest({
    body: { phone }, sourceKey, now: 1_000, admit: async () => true,
    enqueue: async (job) => { queued = job; },
  });
  assert.equal(result.status, 202);
  const processed = await processQueuedGuidePhoneIssuance({
    job: queued, now: 1_001,
    loadContext: async () => ({ guideCandidates: [], issuedAt: [] }),
    persistChallenge: async () => assert.fail("must not persist"),
    sendCode: async () => assert.fail("must not send"),
  });
  assert.equal(processed.issued, false);
  assert.equal(processed.reason, "guide_not_available");
});

test("admission denial creates no job or record and returns the generic acknowledgement", async () => {
  let enqueueCalls = 0;
  const result = await handleQueuedGuidePhoneIssuanceRequest({
    body: { phone }, sourceKey, now: 1_000,
    admit: async (input) => {
      assert.deepEqual(input, { sourceKey, acceptedAt: 1_000 });
      return false;
    },
    enqueue: async () => { enqueueCalls += 1; },
  });
  assert.equal(result.status, 202);
  assert.equal(result.body.ok, true);
  assert.equal(enqueueCalls, 0);
});

test("invalid edge identity and malformed admission result do not enqueue", async () => {
  for (const [key, admit] of [["from-browser", async () => true], [sourceKey, async () => "yes"]]) {
    const result = await handleQueuedGuidePhoneIssuanceRequest({
      body: { phone }, sourceKey: key, admit,
      enqueue: async () => assert.fail("must not queue"),
    });
    assert.equal(result.status, 202);
    assert.equal(result.body.ok, true);
  }
});
