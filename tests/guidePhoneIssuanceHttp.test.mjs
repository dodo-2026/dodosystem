import assert from "node:assert/strict";
import { test } from "node:test";

import {
  handleGuidePhoneIssuanceRequest,
  parseGuidePhoneIssuancePayload,
} from "../lib/server/guidePhoneIssuanceHttp.ts";

const challengeId = "123e4567-e89b-42d3-a456-426614174000";

test("accepts only one bounded ASCII phone field", () => {
  assert.deepEqual(parseGuidePhoneIssuancePayload({ phone: "090-1234-5678" }), {
    phone: "090-1234-5678",
  });
  assert.deepEqual(
    parseGuidePhoneIssuancePayload(
      Object.assign(Object.create(null), { phone: "+81 (90) 1234-5678" })
    ),
    { phone: "+81 (90) 1234-5678" }
  );

  for (const value of [
    null,
    [],
    "09012345678",
    {},
    { phone: 9012345678 },
    { phone: "" },
    { phone: "０９０１２３４５６７８" },
    { phone: "090\t1234\t5678" },
    { phone: "09012345678", extra: true },
    { phone: "0".repeat(33) },
  ]) {
    assert.equal(parseGuidePhoneIssuancePayload(value), null);
  }
});

test("rejects malformed input before invoking issuance", async () => {
  let issueCalls = 0;
  const result = await handleGuidePhoneIssuanceRequest({
    body: { phone: "09012345678", extra: "unexpected" },
    issue: async () => {
      issueCalls += 1;
      throw new Error("must not issue");
    },
  });

  assert.deepEqual(result, {
    status: 400,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    body: { ok: false, error: "invalid_request" },
  });
  assert.equal(issueCalls, 0);
});

test("maps every ordinary denial to the same outward response", async () => {
  const reasons = [
    "invalid_phone",
    "guide_not_available",
    "cooldown",
    "rate_limited",
    "state_conflict",
  ];
  const responses = [];

  for (const reason of reasons) {
    responses.push(
      await handleGuidePhoneIssuanceRequest({
        body: { phone: "09012345678" },
        issue: async () => ({
          issued: false,
          reason,
          retryAt: reason === "cooldown" ? 1_060 : null,
        }),
      })
    );
  }

  for (const response of responses) {
    assert.deepEqual(response, {
      status: 202,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
      body: { ok: true, challengeId: response.body.challengeId },
    });
    assert.match(response.body.challengeId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(JSON.stringify(response).includes("retryAt"), false);
  }
  assert.equal(new Set(responses.map((r) => r.body.challengeId)).size, reasons.length);
});

test("returns only the normalized challenge handle after issuance", async () => {
  const result = await handleGuidePhoneIssuanceRequest({
    body: { phone: "090-1234-5678" },
    issue: async (phone) => {
      assert.equal(phone, "090-1234-5678");
      return {
        issued: true,
        challengeId: challengeId.toUpperCase(),
        expiresAt: 1_600,
      };
    },
  });

  assert.deepEqual(result, {
    status: 202,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    body: { ok: true, challengeId },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("090-1234-5678"), false);
  assert.equal(serialized.includes("expiresAt"), false);
  assert.equal(serialized.includes("code"), false);
  assert.equal(serialized.includes("guideId"), false);
});

test("fails closed on malformed internal issuance results", async () => {
  const events = [];
  for (const invalid of [null, {}, { issued: "yes", challengeId },
    { issued: false, reason: "not_a_real_reason" },
    { issued: true, challengeId: "not-a-uuid" },
    { issued: true, challengeId: "123e4567-e89b-12d3-a456-426614174000" }]) {
    const response = await handleGuidePhoneIssuanceRequest({
      body: { phone: "09012345678" },
      issue: async () => invalid,
      onInternalFailure: (event) => events.push(event),
    });
    assert.equal(response.status, 202);
    assert.equal(response.body.ok, true);
    assert.notEqual(response.body.challengeId, challengeId);
  }
  assert.deepEqual(events, Array(6).fill("guide_phone_issuance_failed"));
});

test("provider and monitoring failures reveal no exception or account details", async () => {
  const response = await handleGuidePhoneIssuanceRequest({
      body: { phone: "09012345678" },
      issue: async () => {
        throw new Error("sensitive provider details: 09012345678 code 123456");
      },
      onInternalFailure: (event) => {
        assert.equal(event, "guide_phone_issuance_failed");
        throw new Error("monitor unavailable");
      },
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.ok, true);
  assert.deepEqual(Object.keys(response.body).sort(), ["challengeId", "ok"]);
  assert.equal(JSON.stringify(response).includes("sensitive"), false);
  assert.equal(JSON.stringify(response).includes("09012345678"), false);
});

test("success, denial and provider failure have identical status, headers, keys and length", async () => {
  const issueHandlers = [
    async () => ({ issued: true, challengeId, expiresAt: 1_600 }),
    async () => ({ issued: false, reason: "guide_not_available", retryAt: null }),
    async () => { throw new Error("fake provider failure"); },
  ];
  const responses = await Promise.all(issueHandlers.map((issue) =>
    handleGuidePhoneIssuanceRequest({ body: { phone: "09012345678" }, issue })
  ));
  const baseline = responses[0];
  for (const response of responses) {
    assert.equal(JSON.stringify(response).length, JSON.stringify(baseline).length);
    assert.deepEqual({ ...response, body: { ...response.body, challengeId: "<opaque>" } },
      { ...baseline, body: { ...baseline.body, challengeId: "<opaque>" } });
  }
});
