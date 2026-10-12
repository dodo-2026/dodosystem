import type { GuideReceiptAcknowledgementResponseBody } from "../server/guideReceiptAcknowledgementHttp.ts";
import {
  beginGuideReceiptAcknowledgement,
  completeGuideReceiptAcknowledgement,
  createGuideReceiptAcknowledgementFormState,
  type GuideReceiptAcknowledgementFormState,
} from "./guideReceiptAcknowledgementForm.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEMPORARY_FAILURE = Object.freeze({
  ok: false,
  error: "temporarily_unavailable",
} as const);

type ReceiptMutation = (
  body: Readonly<{ documentId: string }>
) => Promise<GuideReceiptAcknowledgementResponseBody>;

function isResponse(value: unknown): value is GuideReceiptAcknowledgementResponseBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const result = value as Record<string, unknown>;
  const keys = Object.keys(result);
  if (keys.length !== 2 || !Object.hasOwn(result, "ok")) return false;
  if (result.ok === true) {
    return Object.hasOwn(result, "acknowledgedAt") &&
      Number.isSafeInteger(result.acknowledgedAt) &&
      (result.acknowledgedAt as number) >= 0;
  }
  return result.ok === false && Object.hasOwn(result, "error") &&
    (result.error === "invalid_request" || result.error === "unavailable" ||
      result.error === "temporarily_unavailable");
}

/**
 * Local UI orchestration for a future receipt form. The injected mutation must
 * enforce guide authentication and atomic persistence on the server; this
 * controller is never an authorization boundary. It opens no route or network
 * connection. Each instance is bound to one document and permits one pending
 * submission. Only public response fields reach its state observer.
 */
export function createGuideReceiptAcknowledgementController({
  documentId,
  receipt,
  mutate,
  createSubmissionId = () => crypto.randomUUID(),
  onStateChange,
}: {
  documentId: string;
  receipt: Readonly<{
    status: "pending" | "acknowledged" | "void";
    acknowledgedAt: number | null;
  }>;
  mutate: ReceiptMutation;
  createSubmissionId?: () => string;
  onStateChange?: (state: GuideReceiptAcknowledgementFormState) => void;
}) {
  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) {
    throw new Error("documentId must be a valid UUID.");
  }
  const body = Object.freeze({ documentId: documentId.toLowerCase() });
  let state = createGuideReceiptAcknowledgementFormState(receipt);

  function update(next: GuideReceiptAcknowledgementFormState) {
    state = next;
    try {
      onStateChange?.(state);
    } catch {
      // A UI observer must not interrupt persistence or turn success into retry.
    }
  }

  async function submit(): Promise<GuideReceiptAcknowledgementFormState> {
    if (!state.canSubmit) return state;
    const pending = beginGuideReceiptAcknowledgement(state, createSubmissionId());
    if (pending.phase !== "submitting") return state;
    update(pending);

    let next: GuideReceiptAcknowledgementFormState;
    try {
      const result: unknown = await mutate(body);
      next = completeGuideReceiptAcknowledgement(
        pending, pending.submissionId, isResponse(result) ? result : TEMPORARY_FAILURE
      );
    } catch {
      next = completeGuideReceiptAcknowledgement(
        pending, pending.submissionId, TEMPORARY_FAILURE
      );
    }
    update(next);
    return state;
  }

  return Object.freeze({ getState: () => state, submit });
}
