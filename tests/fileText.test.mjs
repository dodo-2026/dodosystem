import assert from "node:assert/strict";
import test from "node:test";

import {
  containsUnsafeControlCharacters,
  decodeUtf8File,
} from "../lib/dodo/fileText.ts";

test("decodes valid UTF-8 and removes its byte-order mark", () => {
  const bytes = new Uint8Array([
    0xef, 0xbb, 0xbf, 0xe3, 0x82, 0xac, 0xe3, 0x82, 0xa4, 0xe3, 0x83, 0x89,
  ]);

  assert.equal(decodeUtf8File(bytes.buffer), "ガイド");
});

test("rejects Shift_JIS and corrupted byte sequences", () => {
  const shiftJisForJapaneseA = new Uint8Array([0x82, 0xa0]);
  const truncatedUtf8 = new Uint8Array([0xe3, 0x81]);

  assert.equal(decodeUtf8File(shiftJisForJapaneseA.buffer), null);
  assert.equal(decodeUtf8File(truncatedUtf8.buffer), null);
});

test("detects NUL and other binary control characters", () => {
  assert.equal(containsUnsafeControlCharacters("正常,な値\u0000混入"), true);
  assert.equal(containsUnsafeControlCharacters("正常,な値\u000b混入"), true);
  assert.equal(containsUnsafeControlCharacters("正常,な値\u007f混入"), true);
  assert.equal(containsUnsafeControlCharacters("正常,な値\u0085混入"), true);
});

test("allows tabs and ordinary CSV line endings", () => {
  assert.equal(
    containsUnsafeControlCharacters("受付番号\t金額\r\nDODO-001\t1200\n"),
    false
  );
});
