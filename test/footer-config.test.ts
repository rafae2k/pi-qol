import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SUMMARY_EVERY, readConfig, splitModelRef } from "../src/config.ts";
import { formatContext, formatLocation, formatModel, shortSessionId } from "../src/footer.ts";

test("footer parts", () => {
  assert.equal(formatLocation("my-app", "main"), "my-app (main)");
  assert.equal(formatLocation("my-app", null), "my-app");
  assert.equal(formatContext(16.8), "17%");
  assert.equal(formatContext(null), "?");
  assert.equal(formatModel("claude-opus-5-5", "high"), "opus-5-5 high");
  assert.equal(formatModel("gpt-5", undefined), "gpt-5");
  assert.equal(formatModel(undefined, undefined), "no model");
  assert.equal(shortSessionId("01a1f846-9aeb-72cd-a24e-711e83496fc3"), "01a1f846-9aeb");
});

test("config defaults and validation", () => {
  assert.deepEqual(readConfig({}), {
    summaryModel: undefined,
    summaryEvery: DEFAULT_SUMMARY_EVERY,
    summaryLanguage: undefined,
  });
  assert.deepEqual(
    readConfig({
      "pi-qol": { summaryModel: "anthropic/claude-haiku-5-5", summaryEvery: 5, summaryLanguage: "English" },
    }),
    {
      summaryModel: "anthropic/claude-haiku-5-5",
      summaryEvery: 5,
      summaryLanguage: "English",
    },
  );
  assert.equal(readConfig({ "pi-qol": { summaryModel: "no-slash", summaryEvery: -1 } }).summaryModel, undefined);
  assert.equal(readConfig({ "pi-qol": { summaryEvery: 0 } }).summaryEvery, DEFAULT_SUMMARY_EVERY);
  assert.deepEqual(splitModelRef("openrouter/google/gemini-flash"), ["openrouter", "google/gemini-flash"]);
});
