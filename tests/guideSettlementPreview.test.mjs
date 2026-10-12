import assert from "node:assert/strict";
import test from "node:test";

import { createGuideSettlementPreview } from "../lib/dodo/guideSettlementPreview.ts";

test("builds an immutable fictional monthly settlement preview", () => {
  const preview = createGuideSettlementPreview();
  assert.equal(preview.kind, "settlement");
  assert.equal(preview.details.length, 3);
  assert.equal(preview.statusLabel, "支払済");
  assert.equal(Object.isFrozen(preview), true);
  assert.equal(Object.isFrozen(preview.details), true);
});

test("keeps preview totals equal to independently supplied detail values", () => {
  const preview = createGuideSettlementPreview();
  assert.deepEqual(preview.totals.map((total) => total.value), [
    "¥54,000",
    "¥5,400",
    "¥0",
    "¥48,600",
  ]);
  assert.doesNotMatch(JSON.stringify(preview), /account|phone|token|storage|wechat/i);
});
