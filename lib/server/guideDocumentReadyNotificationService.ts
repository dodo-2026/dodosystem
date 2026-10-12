import {
  prepareGuideDocumentReadyNotification,
  type GuideDocumentReadyNotificationClaim,
  type GuideDocumentReadyNotificationDecision,
  type GuideDocumentReadyRecord,
} from "./guideDocumentReadyNotificationPolicy.ts";
import {
  normalizeGuideSessionGuideId,
  verifyGuideSession,
} from "./guideSession.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DENIED: GuideDocumentReadyNotificationDecision = Object.freeze({ allowed: false });

type VerifySession = (token: string | undefined) => Promise<string | null>;

/**
 * Composes signed-session verification, an owned-document read and the
 * one-time notification policy. Every integration remains injected: this
 * module adds no route, live persistence adapter or notification provider.
 */
export async function preparePersistedGuideDocumentReadyNotification({
  sessionToken,
  documentId,
  loadDocument,
  claimIdempotencyKey,
  verifySession = verifyGuideSession,
  onPrivateError,
}: {
  sessionToken: string | undefined;
  documentId: string;
  loadDocument: (documentId: string) => Promise<GuideDocumentReadyRecord | null>;
  claimIdempotencyKey: (claim: GuideDocumentReadyNotificationClaim) => Promise<boolean>;
  verifySession?: VerifySession;
  onPrivateError?: (event: "guide_document_ready_notification_failed") => void;
}): Promise<GuideDocumentReadyNotificationDecision> {
  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) return DENIED;
  const normalizedDocumentId = documentId.toLowerCase();

  try {
    const verifiedGuideId = await verifySession(sessionToken);
    if (!verifiedGuideId) return DENIED;
    const normalizedGuideId = normalizeGuideSessionGuideId(verifiedGuideId);

    const document = await loadDocument(normalizedDocumentId);
    if (
      !document ||
      typeof document.documentId !== "string" ||
      document.documentId.toLowerCase() !== normalizedDocumentId
    ) {
      return DENIED;
    }

    return await prepareGuideDocumentReadyNotification({
      verifiedGuideId: normalizedGuideId,
      document,
      claimIdempotencyKey,
    });
  } catch {
    try {
      onPrivateError?.("guide_document_ready_notification_failed");
    } catch {
      // Observability must not change the fixed outward result.
    }
    return DENIED;
  }
}
