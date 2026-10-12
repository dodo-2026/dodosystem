import {
  createGuidePhoneChallengeEnvelope,
  type GuidePhoneChallengeCreationEnvelope,
} from "./guidePhoneChallengeCreation.ts";
import {
  decideGuidePhoneCodeIssuance,
  type GuidePhoneIssuanceDecision,
} from "./guidePhoneIssuancePolicy.ts";
import {
  decideGuidePhoneMatch,
  type GuidePhoneCandidate,
} from "./guidePhoneGuideMatch.ts";
import { normalizeJapaneseMobilePhone } from "../dodo/guidePortal.ts";

type GuidePhoneIssuanceDenial = Extract<
  GuidePhoneIssuanceDecision,
  { allowed: false }
> | {
  allowed: false;
  reason: "guide_not_available";
  retryAt: null;
};

export type GuidePhoneIssuancePreparation =
  | {
      prepared: false;
      decision: GuidePhoneIssuanceDenial;
    }
  | {
      prepared: true;
      delivery: GuidePhoneChallengeCreationEnvelope["delivery"] & {
        phoneE164: string;
      };
      persisted: GuidePhoneChallengeCreationEnvelope["persisted"] & {
        guideId: string;
        phoneE164: string;
      };
    };

/**
 * Prepares a local-only guide phone challenge after the issuance policy has
 * accepted the request. A denial returns before UUID, random-code or digest
 * generation, so rejected requests consume no cryptographic work and expose
 * no delivery value.
 *
 * A future live caller must atomically record the accepted issuance and the
 * persistable challenge before handing `delivery.code` to the SMS
 * provider. This helper intentionally performs no DB write or external send.
 */
export async function prepareGuidePhoneCodeIssuance({
  phone,
  guideCandidates,
  issuedAt,
  challengeId,
  now = Math.floor(Date.now() / 1000),
}: {
  phone: string;
  guideCandidates: readonly GuidePhoneCandidate[];
  issuedAt: readonly number[];
  challengeId?: string;
  now?: number;
}): Promise<GuidePhoneIssuancePreparation> {
  const phoneE164 =
    typeof phone === "string" ? normalizeJapaneseMobilePhone(phone) : null;
  if (!phoneE164) {
    return {
      prepared: false,
      decision: { allowed: false, reason: "invalid_phone", retryAt: null },
    };
  }

  const guideMatch = decideGuidePhoneMatch({
    phoneE164,
    candidates: guideCandidates,
  });
  if (!guideMatch.matched) {
    return {
      prepared: false,
      decision: {
        allowed: false,
        reason: "guide_not_available",
        retryAt: null,
      },
    };
  }

  const decision = decideGuidePhoneCodeIssuance({
    phone: phoneE164,
    issuedAt,
    now,
  });

  if (!decision.allowed) {
    return { prepared: false, decision };
  }

  const envelope = await createGuidePhoneChallengeEnvelope({ now, challengeId });
  return {
    prepared: true,
    delivery: {
      phoneE164: decision.phoneE164,
      code: envelope.delivery.code,
    },
    persisted: {
      guideId: guideMatch.guideId,
      phoneE164: decision.phoneE164,
      ...envelope.persisted,
    },
  };
}
