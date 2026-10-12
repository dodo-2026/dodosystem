import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { issueGuidePhoneCode } from "../lib/server/guidePhoneIssuance.ts";
import { handleGuidePhoneIssuanceRequest } from "../lib/server/guidePhoneIssuanceHttp.ts";
import { handleGuidePhoneVerificationRequest } from "../lib/server/guidePhoneVerificationHttp.ts";
import { verifyGuideSession } from "../lib/server/guideSession.ts";

const guideId = "123e4567-e89b-42d3-a456-426614174001";
const phone = "+819012345678";
const savedEnvironment = {};
const secretNames = ["GUIDE_PHONE_CODE_SECRET", "GUIDE_SESSION_SECRET"];

beforeEach(() => {
  for (const name of secretNames) savedEnvironment[name] = process.env[name];
  process.env.GUIDE_PHONE_CODE_SECRET = "test-only-phone-secret-never-used-in-production";
  process.env.GUIDE_SESSION_SECRET = "test-only-session-secret-never-used-in-production";
});
afterEach(() => {
  for (const name of secretNames) {
    if (savedEnvironment[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnvironment[name];
  }
});

// This adapter belongs only to the test suite. It is not a production store:
// real persistence must enforce the same conditions in a database transaction.
function createHarness() {
  const records = new Map();
  const deliveries = [];
  const events = [];
  let now = 1_000;

  const request = () => handleGuidePhoneIssuanceRequest({
    body: { phone },
    issue: (input) => issueGuidePhoneCode({
      phone: input,
      now,
      loadContext: async () => ({
        guideCandidates: [{ guideId, phoneE164: phone, isActive: true }],
        issuedAt: [...records.values()].map((r) => r.state.createdAt),
      }),
      persistChallenge: async (record) => {
        if (records.has(record.challengeId)) return false;
        records.set(record.challengeId, structuredClone(record));
        events.push("persist");
        return true;
      },
      sendCode: async (delivery) => {
        assert.ok(records.size > 0);
        deliveries.push(structuredClone(delivery));
        events.push("fake-send");
      },
    }),
  });

  const verify = (challengeId, code) => handleGuidePhoneVerificationRequest({
    body: { challengeId, code },
    now,
    load: async (id) => structuredClone(records.get(id) ?? null),
    commit: async ({ challengeId: id, guideId: owner, expectedState, nextState }) => {
      const current = records.get(id);
      if (!current || current.guideId !== owner ||
          !isDeepStrictEqual(current.state, expectedState)) return false;
      records.set(id, { ...current, state: structuredClone(nextState) });
      events.push("commit");
      return true;
    },
  });

  return { request, verify, records, deliveries, events, setNow: (value) => { now = value; } };
}

test("real issuance and verification services produce a valid guide session only once", async () => {
  const flow = createHarness();
  const requested = await flow.request();
  assert.equal(requested.body.ok, true);
  const { challengeId } = requested.body;
  const { code } = flow.deliveries[0];
  assert.deepEqual(flow.events, ["persist", "fake-send"]);
  assert.match(code, /^[0-9]{6}$/);
  assert.deepEqual(Object.keys(flow.records.get(challengeId)).sort(),
    ["challengeId", "codeDigest", "guideId", "phoneE164", "state"]);
  assert.deepEqual(Object.keys(requested.body).sort(), ["challengeId", "ok"]);

  const verified = await flow.verify(challengeId, code);
  assert.equal(verified.status, 200);
  assert.equal(await verifyGuideSession(verified.cookie.value), guideId);
  assert.equal(verified.cookie.name, "dodo_guide_session");
  assert.equal(flow.records.get(challengeId).state.consumedAt, 1_000);
  assert.deepEqual(flow.events, ["persist", "fake-send", "commit"]);

  const replayed = await flow.verify(challengeId, code);
  assert.equal(replayed.status, 401);
  assert.equal("cookie" in replayed, false);
  assert.equal(flow.events.filter((event) => event === "commit").length, 1);
  const resend = await flow.request();
  assert.equal(resend.body.ok, true);
  assert.notEqual(resend.body.challengeId, challengeId);
  assert.equal(flow.records.has(resend.body.challengeId), false);
  const decoyVerification = await flow.verify(resend.body.challengeId, code);
  assert.equal(decoyVerification.status, 401);
  assert.equal("cookie" in decoyVerification, false);
  assert.equal(flow.deliveries.length, 1);
});

test("two simultaneous confirmations of an issued code yield exactly one valid session", async () => {
  const flow = createHarness();
  const requested = await flow.request();
  const { challengeId } = requested.body;
  const { code } = flow.deliveries[0];
  const results = await Promise.all([
    flow.verify(challengeId, code), flow.verify(challengeId, code),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const winner = results.find((r) => r.status === 200);
  assert.equal(await verifyGuideSession(winner.cookie.value), guideId);
  assert.equal(results.filter((r) => "cookie" in r).length, 1);
  assert.equal(flow.events.filter((event) => event === "commit").length, 1);
});

test("wrong codes lock the stored challenge and an expired replacement cannot log in", async () => {
  const flow = createHarness();
  const requested = await flow.request();
  const { challengeId } = requested.body;
  const { code } = flow.deliveries[0];
  const wrongCode = code === "000000" ? "000001" : "000000";
  for (let count = 1; count <= 5; count += 1) {
    const result = await flow.verify(challengeId, wrongCode);
    assert.equal(result.status, 401);
    assert.equal("cookie" in result, false);
    assert.equal(flow.records.get(challengeId).state.failedAttempts, count);
  }
  assert.equal((await flow.verify(challengeId, code)).status, 401);
  assert.equal(flow.records.get(challengeId).state.consumedAt, null);

  flow.setNow(1_060);
  const replacement = await flow.request();
  assert.equal(replacement.body.ok, true);
  flow.setNow(1_660);
  const expired = await flow.verify(replacement.body.challengeId, flow.deliveries[1].code);
  assert.equal(expired.status, 401);
  assert.equal("cookie" in expired, false);
  assert.equal(flow.records.get(replacement.body.challengeId).state.consumedAt, null);
});
