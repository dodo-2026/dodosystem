import assert from "node:assert/strict";
import test from "node:test";

import { createGuideDocumentReadyNotificationPreview } from "../lib/dodo/guideDocumentReadyNotificationPreview.ts";

test("builds an immutable request-free document-ready notification preview", () => {
  const preview = createGuideDocumentReadyNotificationPreview();
  assert.equal(preview.schemaVersion, 1);
  assert.equal(preview.deliveryEnabled, false);
  assert.equal(Object.isFrozen(preview), true);
  assert.match(preview.body, /本人確認後/);
});

test("keeps private document and authentication material out of the notification", () => {
  const serialized = JSON.stringify(createGuideDocumentReadyNotificationPreview());
  assert.doesNotMatch(serialized, /https?:|signed|token|cookie|session|pdf|uuid|口座番号/i);
  assert.doesNotMatch(serialized, /¥|￥|\b\d{6}\b/);
  assert.match(serialized, /記載しません/);
});
