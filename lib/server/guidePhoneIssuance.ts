import { normalizeJapaneseMobilePhone } from "../dodo/guidePortal.ts";
import type { GuidePhoneCandidate } from "./guidePhoneGuideMatch.ts";
import {
  prepareGuidePhoneCodeIssuance,
  type GuidePhoneIssuancePreparation,
} from "./guidePhoneIssuancePreparation.ts";

type PreparedIssuance = Extract<
  GuidePhoneIssuancePreparation,
  { prepared: true }
>;

export type GuidePhoneIssuanceContext = {
  guideCandidates: readonly GuidePhoneCandidate[];
  issuedAt: readonly number[];
};

export type GuidePhonePersistedChallenge = Readonly<
  Omit<PreparedIssuance["persisted"], "state"> & {
    state: Readonly<PreparedIssuance["persisted"]["state"]>;
  }
>;

export type GuidePhoneCodeDelivery = Readonly<PreparedIssuance["delivery"]>;

export type GuidePhoneIssuanceResult =
  | {
      issued: false;
      reason:
        | "invalid_phone"
        | "guide_not_available"
        | "cooldown"
        | "rate_limited"
        | "state_conflict";
      retryAt: number | null;
    }
  | {
      issued: true;
      challengeId: string;
      expiresAt: number;
    };

/**
 * Coordinates the server-only request-code flow without choosing a database
 * or SMS provider. An accepted challenge is sent only after its full
 * persistable record has been atomically accepted by the injected store.
 *
 * The successful return value deliberately excludes the phone number, code,
 * digest and guide ID. A send failure is allowed to propagate after the
 * accepted persistence so the failed attempt still counts toward throttling.
 */
export async function issueGuidePhoneCode({
  phone,
  challengeId,
  loadContext,
  persistChallenge,
  sendCode,
  now = Math.floor(Date.now() / 1000),
}: {
  phone: string;
  /** Trusted server-generated queue receipt, not a client-chosen value. */
  challengeId?: string;
  loadContext: (phoneE164: string) => Promise<GuidePhoneIssuanceContext>;
  persistChallenge: (
    challenge: GuidePhonePersistedChallenge
  ) => Promise<boolean>;
  sendCode: (delivery: GuidePhoneCodeDelivery) => Promise<void>;
  now?: number;
}): Promise<GuidePhoneIssuanceResult> {
  const phoneE164 =
    typeof phone === "string" ? normalizeJapaneseMobilePhone(phone) : null;
  if (!phoneE164) {
    return { issued: false, reason: "invalid_phone", retryAt: null };
  }

  const context = await loadContext(phoneE164);
  const preparation = await prepareGuidePhoneCodeIssuance({
    phone: phoneE164,
    guideCandidates: context.guideCandidates,
    issuedAt: context.issuedAt,
    challengeId,
    now,
  });

  if (!preparation.prepared) {
    return {
      issued: false,
      reason: preparation.decision.reason,
      retryAt: preparation.decision.retryAt,
    };
  }

  const persisted = Object.freeze({
    ...preparation.persisted,
    state: Object.freeze({ ...preparation.persisted.state }),
  });
  const delivery = Object.freeze({ ...preparation.delivery });
  const persistedSuccessfully = await persistChallenge(persisted);

  if (typeof persistedSuccessfully !== "boolean") {
    throw new Error("persistChallenge must resolve to a boolean.");
  }
  if (!persistedSuccessfully) {
    return { issued: false, reason: "state_conflict", retryAt: null };
  }

  await sendCode(delivery);

  return Object.freeze({
    issued: true,
    challengeId: persisted.challengeId,
    expiresAt: persisted.state.expiresAt,
  });
}
