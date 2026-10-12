const GUIDE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JAPANESE_MOBILE_E164_PATTERN = /^\+81[789]0\d{8}$/;

export type GuidePhoneCandidate = {
  guideId: string;
  phoneE164: string | null;
  isActive: boolean;
};

export type GuidePhoneMatchDecision =
  | { matched: true; guideId: string }
  | { matched: false; reason: "guide_not_available" };

function requireCandidate(
  candidate: GuidePhoneCandidate,
  index: number
): GuidePhoneCandidate {
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`candidates[${index}] must be a guide record.`);
  }
  if (
    typeof candidate.guideId !== "string" ||
    !GUIDE_ID_PATTERN.test(candidate.guideId)
  ) {
    throw new Error(`candidates[${index}].guideId must be a valid UUID.`);
  }
  if (
    candidate.phoneE164 !== null &&
    (typeof candidate.phoneE164 !== "string" ||
      !JAPANESE_MOBILE_E164_PATTERN.test(candidate.phoneE164))
  ) {
    throw new Error(
      `candidates[${index}].phoneE164 must be a Japanese mobile E.164 number or null.`
    );
  }
  if (typeof candidate.isActive !== "boolean") {
    throw new Error(`candidates[${index}].isActive must be boolean.`);
  }
  return candidate;
}

/**
 * Resolves one normalized phone number to exactly one active DODO guide.
 * Missing, inactive and ambiguous matches intentionally share the same result
 * so a future public endpoint cannot reveal whether an account exists.
 */
export function decideGuidePhoneMatch({
  phoneE164,
  candidates,
}: {
  phoneE164: string;
  candidates: readonly GuidePhoneCandidate[];
}): GuidePhoneMatchDecision {
  if (
    typeof phoneE164 !== "string" ||
    !JAPANESE_MOBILE_E164_PATTERN.test(phoneE164)
  ) {
    throw new Error("phoneE164 must be a normalized Japanese mobile number.");
  }
  if (!Array.isArray(candidates)) {
    throw new Error("candidates must be an array of guide records.");
  }

  const matches = candidates.filter((candidate, index) => {
    const valid = requireCandidate(candidate, index);
    return valid.isActive && valid.phoneE164 === phoneE164;
  });

  if (matches.length !== 1) {
    return { matched: false, reason: "guide_not_available" };
  }

  return { matched: true, guideId: matches[0].guideId.toLowerCase() };
}
