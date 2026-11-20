import assert from "node:assert/strict";
import { test } from "node:test";
import { summaryCandidates } from "../src/models.ts";

const haiku = { provider: "anthropic", id: "claude-haiku-4-5" };
const gpt = { provider: "openai", id: "gpt-5" };

test("configured model first, then the session model", () => {
  assert.deepEqual(summaryCandidates(haiku, gpt, 0, 1_000), [haiku, gpt]);
});

test("a configured model that failed recently is skipped until the cooldown ends", () => {
  assert.deepEqual(summaryCandidates(haiku, gpt, 5_000, 1_000), [gpt]);
  assert.deepEqual(summaryCandidates(haiku, gpt, 5_000, 5_000), [haiku, gpt]);
});

test("no duplicate when the session already uses the configured model", () => {
  assert.deepEqual(summaryCandidates(haiku, { ...haiku }, 0, 1_000), [haiku]);
});

test("without a configured model, the session model; with nothing else, the configured one anyway", () => {
  assert.deepEqual(summaryCandidates(undefined, gpt, 0, 1_000), [gpt]);
  assert.deepEqual(summaryCandidates(haiku, undefined, 5_000, 1_000), [haiku]);
  assert.deepEqual(summaryCandidates(undefined, undefined, 0, 1_000), []);
});
