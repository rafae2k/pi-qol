import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findImagePaths,
  isBackspacePress,
  isCtrlVPress,
  isKeyRelease,
  mayMoveCursor,
  parsePastedImagePath,
  trailingMarker,
  unwrapBracketedPaste,
} from "../src/paste.ts";

const HOME = "/Users/me";

test("Ctrl+V counts once: legacy byte and kitty press, never the release", () => {
  assert.ok(isCtrlVPress("\x16"));
  assert.ok(isCtrlVPress("\x1b[118;5u"));
  assert.ok(isCtrlVPress("\x1b[118;5:1u"));
  assert.ok(isCtrlVPress("\x1b[118:86;5u")); // alternate-key report
  assert.equal(isCtrlVPress("\x1b[118;5:3u"), false);
  assert.equal(isCtrlVPress("\x1b[118;5:2u"), false); // auto-repeat
  assert.ok(isKeyRelease("\x1b[118;5:3u"));
  assert.equal(isKeyRelease("\x1b[118;5u"), false);
});

test("Backspace press in legacy and kitty encodings", () => {
  assert.ok(isBackspacePress("\x7f"));
  assert.ok(isBackspacePress("\x1b[127u"));
  assert.ok(isBackspacePress("\x1b[127;1:1u"));
  assert.equal(isBackspacePress("\x1b[127;1:3u"), false);
  assert.equal(isBackspacePress("a"), false);
});

test("arrows and control keys may move the cursor, text and pastes do not", () => {
  assert.ok(mayMoveCursor("\x1b[D"));
  assert.ok(mayMoveCursor("\x01"));
  assert.equal(mayMoveCursor("a"), false);
  assert.equal(mayMoveCursor("\r"), false);
  assert.equal(mayMoveCursor("\x1b[200~x\x1b[201~"), false);
});

test("unwrapBracketedPaste only accepts a complete paste", () => {
  assert.equal(unwrapBracketedPaste("\x1b[200~hello\x1b[201~"), "hello");
  assert.equal(unwrapBracketedPaste("\x1b[200~hel"), null);
  assert.equal(unwrapBracketedPaste("hello"), null);
});

test("parsePastedImagePath takes exactly one image path, quoted, escaped or with ~", () => {
  assert.equal(parsePastedImagePath("/tmp/a b.png", HOME), "/tmp/a b.png");
  assert.equal(parsePastedImagePath("/tmp/a\\ b.PNG\n", HOME), "/tmp/a b.PNG");
  assert.equal(parsePastedImagePath("'/tmp/a.jpg'", HOME), "/tmp/a.jpg");
  assert.equal(parsePastedImagePath("~/shot.webp", HOME), "/Users/me/shot.webp");
  assert.equal(parsePastedImagePath("/tmp/a.txt", HOME), null);
  assert.equal(parsePastedImagePath("look at /tmp/a.png", HOME), null);
  assert.equal(parsePastedImagePath("/tmp/a.png\n/tmp/b.png", HOME), null);
});

test("findImagePaths finds several paths, with spaces, and leaves prose alone", () => {
  const found = findImagePaths("compare /a/one shot.png and ~/two.jpg, please", HOME);
  assert.deepEqual(found, [
    { raw: "/a/one shot.png", path: "/a/one shot.png" },
    { raw: "~/two.jpg", path: "/Users/me/two.jpg" },
  ]);
  assert.deepEqual(findImagePaths("no images in a/b.png here", HOME), []);
});

test("trailingMarker removes the marker and its space only at the end", () => {
  assert.equal(trailingMarker("hi [image 1] ", ["[image 1]"]), "[image 1] ");
  assert.equal(trailingMarker("hi [image 1]", ["[image 1]"]), "[image 1]");
  assert.equal(trailingMarker("[image 1] hi", ["[image 1]"]), null);
});
