export const GUIDE_PHONE_CODE_LENGTH = 6;
export const GUIDE_PHONE_CODE_MAX_ATTEMPTS = 5;
export const GUIDE_PHONE_CODE_TTL_SECONDS = 10 * 60;
export const GUIDE_PORTAL_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type GuideDocumentAccessInput = {
  sessionGuideId: string | null;
  documentGuideId: string;
  documentStatus: "draft" | "final" | "void";
  sessionExpiresAt: number;
  now?: number;
};

export type GuideDocumentAccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "not_signed_in"
        | "session_expired"
        | "different_guide"
        | "document_not_available";
    };

/**
 * Converts a Japanese mobile number into the only form stored by DODO.
 * This does not send a code or prove ownership; that must happen server-side.
 */
export function normalizeJapaneseMobilePhone(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, "");
  const domestic = compact.replace(/^\+81/, "0").replace(/^81/, "0");

  if (!/^0[789]0\d{8}$/.test(domestic)) return null;

  return `+81${domestic.slice(1)}`;
}

export function canViewGuideDocument({
  sessionGuideId,
  documentGuideId,
  documentStatus,
  sessionExpiresAt,
  now = Math.floor(Date.now() / 1000),
}: GuideDocumentAccessInput): GuideDocumentAccessDecision {
  if (!sessionGuideId) return { allowed: false, reason: "not_signed_in" };
  if (!Number.isSafeInteger(sessionExpiresAt) || sessionExpiresAt <= now) {
    return { allowed: false, reason: "session_expired" };
  }
  if (sessionGuideId !== documentGuideId) {
    return { allowed: false, reason: "different_guide" };
  }
  if (documentStatus !== "final") {
    return { allowed: false, reason: "document_not_available" };
  }

  return { allowed: true };
}
