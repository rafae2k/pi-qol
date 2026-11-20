/**
 * compact-footer: a two-line footer with only what you act on.
 *
 *   my-app (main) · 17% · opus-5-5 high
 *   id 01a1f846-9aeb  MCP 0/10
 *
 * Line 1: folder and git branch, context used, model and thinking level.
 * Line 2: status texts from other extensions (session id, MCP, ...).
 * Token and cache counters are left out.
 */

import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { formatContext, formatLocation, formatModel } from "../src/footer.ts";

export default function compactFooter(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          const parts = [
            formatLocation(basename(ctx.cwd), footerData.getGitBranch()),
            formatContext(ctx.getContextUsage()?.percent),
            formatModel(ctx.model?.id, ctx.model?.reasoning ? pi.getThinkingLevel() : undefined),
          ];
          const lines = [truncateToWidth(theme.fg("dim", parts.join(" · ")), width)];
          const statuses = [...footerData.getExtensionStatuses().values()].filter(Boolean);
          if (statuses.length) lines.push(truncateToWidth(statuses.join("  "), width));
          return lines;
        },
      };
    });
  });
}
