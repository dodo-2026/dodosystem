import assert from "node:assert/strict";
import test from "node:test";
import {
  decideGuidePhoneIssuanceAdmission,
  GUIDE_PHONE_MAX_ADMISSIONS_GLOBALLY,
  GUIDE_PHONE_MAX_ADMISSIONS_PER_SOURCE,
} from "../lib/server/guidePhoneIssuanceAdmission.ts";

const sourceKey = "trusted-edge-source-key-0001";
const snapshot = (sourceAcceptedAt = [], globalAcceptedAt = []) => ({ sourceAcceptedAt, globalAcceptedAt });

test("allows a trusted source below both rolling limits", () => {
  assert.equal(decideGuidePhoneIssuanceAdmission({ sourceKey, snapshot: snapshot([950], [941, 999]), now: 1_000 }), true);
});

test("denies either source or global saturation without disclosing which", () => {
  const sourceFull = Array(GUIDE_PHONE_MAX_ADMISSIONS_PER_SOURCE).fill(999);
  const globalFull = Array(GUIDE_PHONE_MAX_ADMISSIONS_GLOBALLY).fill(999);
  assert.equal(decideGuidePhoneIssuanceAdmission({ sourceKey, snapshot: snapshot(sourceFull, []), now: 1_000 }), false);
  assert.equal(decideGuidePhoneIssuanceAdmission({ sourceKey, snapshot: snapshot([], globalFull), now: 1_000 }), false);
});

test("excludes the exact rolling-window boundary", () => {
  assert.equal(decideGuidePhoneIssuanceAdmission({
    sourceKey,
    snapshot: snapshot(Array(GUIDE_PHONE_MAX_ADMISSIONS_PER_SOURCE).fill(940), []),
    now: 1_000,
  }), true);
});

test("rejects browser-like keys and untrusted timestamp snapshots", () => {
  for (const input of [
    { sourceKey: "raw-ip-203.0.113.10", snapshot: snapshot() },
    { sourceKey, snapshot: snapshot([1_001], []) },
    { sourceKey, snapshot: snapshot(["999"], []) },
  ]) {
    assert.throws(() => decideGuidePhoneIssuanceAdmission({ ...input, now: 1_000 }));
  }
});
