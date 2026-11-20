import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPrompt,
  buildTranscript,
  fitsHeader,
  HEADER_LINES,
  parseSummary,
  summaryBudget,
  wrapHeader,
} from "../src/summary.ts";

const msg = (role: string, text: string) => ({ type: "message", message: { role, content: [{ type: "text", text }] } });

test("buildTranscript keeps user and assistant text and counts user turns", () => {
  const { text, userTurns } = buildTranscript([
    msg("user", "add rate limiting"),
    { type: "custom", customType: "x", data: {} },
    msg("assistant", "done"),
    msg("toolResult", "ignored"),
    msg("user", "  "),
    msg("user", "now tests"),
  ]);
  assert.equal(userTurns, 2);
  assert.equal(text, "User: add rate limiting\n\nAssistant: done\n\nUser: now tests");
});

test("buildTranscript keeps the start and the end of long conversations", () => {
  const entries = Array.from({ length: 200 }, (_, i) => msg("user", `message ${i} ${"x".repeat(100)}`));
  const { text } = buildTranscript(entries, 3_000);
  assert.ok(text.length <= 3_100);
  assert.ok(text.includes("message 0 "));
  assert.ok(text.includes("message 199 "));
  assert.ok(text.includes("[...]"));
});

test("parseSummary reads the JSON even with text or a code fence around it", () => {
  assert.deepEqual(parseSummary('```json\n{"title":"Rate limit","summary":"Done."}\n```'), {
    title: "Rate limit",
    summary: "Done.",
  });
  assert.equal(parseSummary("no json here"), null);
  assert.equal(parseSummary('{"title": 1, "summary": "x"}'), null);
  assert.equal(parseSummary('{"title":"","summary":"x"}'), null);
  assert.equal(parseSummary("{broken"), null);
});

test("a summary at budget fits the header at common widths", () => {
  for (const cols of [60, 80, 100, 140]) {
    const budget = summaryBudget(cols);
    const s = { title: "T".repeat(40), summary: "word ".repeat(Math.floor(budget / 5)).trim() };
    assert.ok(fitsHeader(s, cols), `${cols} columns`);
    assert.equal(fitsHeader({ ...s, summary: `${s.summary} ${"long ".repeat(40)}` }, cols), false);
  }
});

test("wrapHeader never exceeds the header rows and marks the cut", () => {
  const lines = wrapHeader("word ".repeat(200), 60);
  assert.equal(lines.length, HEADER_LINES);
  assert.ok(lines[HEADER_LINES - 1].includes("…"));
});

test("buildPrompt follows the user's language unless one is configured", () => {
  assert.match(buildPrompt(200), /language the user writes in/);
  assert.match(buildPrompt(200, "Portuguese"), /Write in Portuguese/);
  assert.match(buildPrompt(123), /at most 123 characters/);
});
