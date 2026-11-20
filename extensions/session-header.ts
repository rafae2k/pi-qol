/**
 * session-header: a pinned title + summary of the conversation at the top of the screen, and the
 * session id in the footer.
 *
 * The summary is written by a model after the first reply and refreshed every few user messages.
 * It is stored in the session (a custom entry, outside the model's context), comes back on resume,
 * and names the session in /resume unless you named it yourself with /name.
 *
 * Commands:
 *   /summary  refresh the summary now
 *   /id       copy `pi --session <id>` to the clipboard
 */

import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readConfig, splitModelRef } from "../src/config.ts";
import { shortSessionId } from "../src/footer.ts";
import {
  buildPrompt,
  buildRequest,
  buildTranscript,
  fitsHeader,
  parseSummary,
  replyText,
  type Summary,
  summaryBudget,
  wrapHeader,
} from "../src/summary.ts";

const ENTRY_TYPE = "pi-qol.session-summary";
const STATUS_KEY = "pi-qol.session-id";
const TIMEOUT_MS = 60_000;

type Outcome = "ok" | "too_long" | "failed";

const columns = () => process.stdout.columns || 80;

export default function sessionHeader(pi: ExtensionAPI) {
  let current: Summary | null = null;
  let running = false;
  // Bumped on every session switch or shutdown: a reply that lands after it is dropped, because the
  // old ctx is stale and touching it throws.
  let generation = 0;
  let overlayDone: (() => void) | null = null;
  let overlayTui: { requestRender(): void } | null = null;

  function closeOverlay() {
    const done = overlayDone;
    overlayDone = null;
    overlayTui = null;
    done?.();
  }

  function showId(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", `id ${shortSessionId(ctx.sessionManager.getSessionId())}`));
  }

  // pi's own header scrolls away with the conversation. A non-capturing overlay anchored at the top
  // stays put and leaves the keyboard to the editor; it covers the top rows of the transcript.
  function showHeader(ctx: ExtensionContext) {
    if (ctx.mode !== "tui" || !current) return;
    ctx.ui.setTitle(`π ${current.title}`);
    if (overlayTui) return overlayTui.requestRender();
    void ctx.ui.custom<void>(
      (tui, theme, _kb, done) => {
        overlayTui = tui;
        overlayDone = () => done(undefined);
        return {
          render(width: number): string[] {
            const s = current;
            if (!s) return [];
            const styled = `${theme.fg("accent", theme.bold(s.title))}${theme.fg("dim", " · ")}${theme.fg("muted", s.summary)}`;
            return [...wrapHeader(styled, width), theme.fg("borderMuted", "─".repeat(Math.max(1, width)))];
          },
          invalidate() {},
        };
      },
      { overlay: true, overlayOptions: { anchor: "top-center", width: "100%", nonCapturing: true } },
    );
  }

  function pickModel(ctx: ExtensionContext) {
    const { summaryModel } = readConfig(pi.getSettings());
    if (summaryModel) {
      const found = ctx.modelRegistry.find(...splitModelRef(summaryModel));
      if (found) return found;
      if (ctx.hasUI)
        ctx.ui.notify(`pi-qol: summaryModel "${summaryModel}" not found, using the session model`, "warning");
    }
    return ctx.model;
  }

  async function request(
    ctx: ExtensionContext,
    transcript: string,
    userTurns: number,
    budget: number,
  ): Promise<Outcome> {
    const model = pickModel(ctx);
    if (!model) return "failed";
    const prompt = buildPrompt(budget, readConfig(pi.getSettings()).summaryLanguage);
    const gen = generation;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await ctx.modelRegistry.complete(
        model,
        {
          systemPrompt: prompt,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: buildRequest(prompt, transcript) }],
              timestamp: Date.now(),
            },
          ],
        },
        // cacheRetention "none" marks a tool-less one-shot (bridges otherwise hand the model their own
        // tools); its own session id keeps it apart from the running conversation.
        { signal: ac.signal, cacheRetention: "none", sessionId: randomUUID() },
      );
      if (gen !== generation) return "failed";
      const parsed = parseSummary(replyText(res.content));
      if (!parsed) return "failed";
      if (!fitsHeader(parsed, columns())) return "too_long";

      const name = pi.getSessionName();
      const autoNamed = !name || (current?.autoNamed === true && name === current.title);
      current = { ...parsed, userTurns, autoNamed };
      pi.appendEntry(ENTRY_TYPE, current);
      if (autoNamed) pi.setSessionName(parsed.title);
      showHeader(ctx);
      return "ok";
    } catch (err) {
      if (gen !== generation) return "failed"; // the session moved on: nothing to report
      // The summary is an accessory: a failure must not disturb the session, so warn and carry on.
      if (ctx.hasUI)
        ctx.ui.notify(`pi-qol: summary failed: ${err instanceof Error ? err.message : String(err)}`, "warning");
      return "failed";
    } finally {
      clearTimeout(timer);
    }
  }

  async function summarize(ctx: ExtensionContext, force = false) {
    if (running) return;
    const { text, userTurns } = buildTranscript(ctx.sessionManager.getBranch());
    if (!text || userTurns === 0) return;
    const { summaryEvery } = readConfig(pi.getSettings());
    if (!force && current && userTurns - current.userTurns < summaryEvery) return;
    running = true;
    try {
      // A model that overshoots its budget gets one retry with a tighter one.
      for (const factor of [1, 0.75]) {
        const outcome = await request(ctx, text, userTurns, Math.floor(summaryBudget(columns()) * factor));
        if (outcome !== "too_long") return;
      }
    } finally {
      running = false;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    current = null;
    closeOverlay();
    for (const entry of ctx.sessionManager.getEntries() as any[]) {
      if (entry.type === "custom" && entry.customType === ENTRY_TYPE && entry.data) current = entry.data as Summary;
    }
    showId(ctx);
    showHeader(ctx);
    // Resumed without a summary, or with one too long for this terminal: write one now.
    if (ctx.mode === "tui" && (!current || !fitsHeader(current, columns()))) void summarize(ctx, true);
  });

  pi.on("session_shutdown", async () => {
    generation++;
    closeOverlay();
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (ctx.mode !== "tui") return; // print mode exits before the reply arrives
    void summarize(ctx); // not awaited: the summary runs on the side
  });

  pi.registerCommand("summary", {
    description: "Refresh the pinned conversation summary now",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Writing summary...", "info");
      await summarize(ctx, true);
    },
  });

  pi.registerCommand("id", {
    description: "Copy `pi --session <id>` for this conversation",
    handler: async (_args, ctx) => {
      const cmd = `pi --session ${ctx.sessionManager.getSessionId()}`;
      const copy =
        process.platform === "darwin" ? ["pbcopy"] : ["sh", "-c", "wl-copy 2>/dev/null || xclip -selection clipboard"];
      const r = await pi.exec("sh", ["-c", `printf %s "$0" | ${copy.join(" ")}`, cmd]).catch(() => ({ code: 1 }));
      ctx.ui.notify(r.code === 0 ? `Copied: ${cmd}` : cmd, "info");
    },
  });
}
