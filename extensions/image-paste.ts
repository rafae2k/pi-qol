/**
 * image-paste: paste images like in a chat app. A short marker goes into the draft, a thumbnail shows
 * above the editor, and the image is attached when you send.
 *
 * Why: terminals paste text only, so Cmd+V of a screenshot pastes its file path. Screenshot tools that
 * put a file and an image on the clipboard (CleanShot, Finder copy) also make pi's own Ctrl+V paste
 * the path.
 *
 *  - Pasting a single image path (any terminal) or pressing Ctrl+V (macOS) inserts "[image 1]".
 *  - Ctrl+V with an image but no file saves it to a temp file; with no image it pastes the text.
 *  - Backspace right after a marker deletes the whole marker. Deleting it any other way works too.
 *  - On send, each marker, and any image path typed into the message, becomes an attachment.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { detectSupportedImageMimeTypeFromFile, resizeImage } from "@earendil-works/pi-coding-agent";
import { Image } from "@earendil-works/pi-tui";
import {
  findImagePaths,
  IMAGE_EXTENSION,
  isBackspacePress,
  isCtrlVPress,
  isKeyRelease,
  markerFor,
  mayMoveCursor,
  parsePastedImagePath,
  trailingMarker,
  unwrapBracketedPaste,
} from "../src/paste.ts";

const run = promisify(execFile);

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 2000; // same as pi's images.autoResize
const THUMB_SIDE = 480;
const THUMB_CELLS = { maxWidthCells: 28, maxHeightCells: 7 };
const WIDGET_KEY = "pi-qol.pasted-images";
const TMP_DIR = join(tmpdir(), "pi-qol-pasted-images");
const IS_MAC = process.platform === "darwin";

interface Pasted {
  marker: string;
  path: string;
  thumb?: Image;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function usableImage(path: string): boolean {
  if (!IMAGE_EXTENSION.test(path) || !existsSync(path)) return false;
  const st = statSync(path);
  return st.isFile() && st.size <= MAX_BYTES;
}

async function osascript(script: string): Promise<string> {
  const { stdout } = await run("osascript", ["-e", script], { timeout: 5_000 });
  return stdout.trim();
}

/** macOS: the image file on the clipboard, else the clipboard image saved to a temp file, else null. */
async function clipboardImagePath(): Promise<string | null> {
  try {
    const path = await osascript("POSIX path of (the clipboard as «class furl»)");
    if (usableImage(path)) return path;
  } catch {
    // no file on the clipboard: try the image itself below
  }
  mkdirSync(TMP_DIR, { recursive: true });
  const out = join(TMP_DIR, `clipboard-${Date.now()}.png`);
  try {
    await osascript(
      `set f to open for access (POSIX file "${out}") with write permission\ntry\nwrite (the clipboard as «class PNGf») to f\nend try\nclose access f`,
    );
  } catch {
    return null; // no image: the caller pastes text
  }
  return existsSync(out) && statSync(out).size > 0 ? out : null;
}

async function loadImage(path: string, side: number): Promise<ImageContent | null> {
  const mimeType = await detectSupportedImageMimeTypeFromFile(path);
  if (!mimeType) return null;
  const bytes = new Uint8Array(readFileSync(path));
  const resized = await resizeImage(bytes, mimeType, { maxWidth: side, maxHeight: side });
  return resized
    ? { type: "image", data: resized.data, mimeType: resized.mimeType }
    : { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType };
}

export default function imagePaste(pi: ExtensionAPI) {
  let pasted: Pasted[] = [];
  let counter = 0;
  let rerender: (() => void) | null = null;
  let unsubscribeInput: (() => void) | null = null;
  // pi does not expose the cursor. Backspace deletes a whole marker only when the draft ends with it
  // and the cursor has not been moved since the paste.
  let cursorAtEnd = true;

  const live = (ctx: ExtensionContext) => {
    const text = ctx.ui.getEditorText();
    return pasted.filter((p) => text.includes(p.marker));
  };

  function showWidget(ctx: ExtensionContext) {
    if (pasted.length === 0) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      rerender = null;
      return;
    }
    if (rerender) return rerender();
    ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
      rerender = () => tui.requestRender();
      return {
        render(width: number): string[] {
          const lines: string[] = [];
          for (const p of live(ctx)) {
            lines.push(theme.fg("dim", ` ${p.marker} ${basename(p.path)}`));
            if (p.thumb) lines.push(...p.thumb.render(width));
          }
          return lines;
        },
        invalidate() {
          for (const p of pasted) p.thumb?.invalidate();
        },
      };
    });
  }

  async function addImage(ctx: ExtensionContext, path: string) {
    counter++;
    const item: Pasted = { marker: markerFor(counter), path };
    pasted.push(item);
    ctx.ui.pasteToEditor(`${item.marker} `);
    cursorAtEnd = true;
    showWidget(ctx);
    try {
      const thumb = await loadImage(path, THUMB_SIDE);
      if (!thumb) return;
      item.thumb = new Image(
        thumb.data,
        thumb.mimeType,
        { fallbackColor: (s) => ctx.ui.theme.fg("dim", s) },
        THUMB_CELLS,
      );
      rerender?.();
    } catch (err) {
      // The thumbnail is an accessory: the attachment is read from the file on send. Warn only.
      ctx.ui.notify(`pi-qol: no thumbnail for ${basename(path)}: ${message(err)}`, "warning");
    }
  }

  async function pasteFromClipboard(ctx: ExtensionContext) {
    const path = await clipboardImagePath();
    if (path) return addImage(ctx, path);
    try {
      const { stdout } = await run("pbpaste", [], { timeout: 5_000 });
      if (stdout) ctx.ui.pasteToEditor(stdout);
    } catch (err) {
      ctx.ui.notify(`pi-qol: could not read the clipboard: ${message(err)}`, "warning");
    }
  }

  pi.on("session_shutdown", async () => {
    unsubscribeInput?.();
    unsubscribeInput = null;
  });

  pi.on("session_start", async (_event, ctx) => {
    pasted = [];
    rerender = null;
    unsubscribeInput?.();
    unsubscribeInput = null;
    if (ctx.mode !== "tui") return;
    unsubscribeInput = ctx.ui.onTerminalInput((data) => {
      if (isKeyRelease(data)) return undefined;

      if (isBackspacePress(data) && pasted.length && cursorAtEnd) {
        const text = ctx.ui.getEditorText();
        const tail = trailingMarker(
          text,
          pasted.map((p) => p.marker),
        );
        if (tail) {
          ctx.ui.setEditorText(text.slice(0, -tail.length));
          setTimeout(() => rerender?.(), 0);
          return { consume: true };
        }
      }

      if (mayMoveCursor(data)) cursorAtEnd = false;
      if (ctx.ui.getEditorText() === "") cursorAtEnd = true;

      if (IS_MAC && isCtrlVPress(data)) {
        void pasteFromClipboard(ctx);
        return { consume: true };
      }

      const pastedText = unwrapBracketedPaste(data);
      if (pastedText !== null) {
        const path = parsePastedImagePath(pastedText, homedir());
        if (path && usableImage(path)) {
          void addImage(ctx, path);
          return { consume: true };
        }
      }

      // Any key may have deleted a marker: redraw the thumbnails after the editor handles it.
      if (pasted.length) setTimeout(() => rerender?.(), 0);
      return undefined;
    });
  });

  pi.on("input", async (event, ctx) => {
    const images = [...(event.images ?? [])];
    let text = event.text;
    let changed = false;

    const attach = async (raw: string, path: string) => {
      try {
        const img = await loadImage(path, MAX_SIDE);
        if (!img) return;
        images.push(img);
        text = text.replace(raw, `[image: ${basename(path)}]`);
        changed = true;
      } catch (err) {
        // Not attached: the text keeps the name and the warning tells the user to resend.
        if (ctx.hasUI) ctx.ui.notify(`pi-qol: did not attach ${basename(path)}: ${message(err)}`, "warning");
      }
    };

    for (const p of pasted) if (text.includes(p.marker)) await attach(p.marker, p.path);
    for (const { raw, path } of findImagePaths(text, homedir())) if (usableImage(path)) await attach(raw, path);

    if (pasted.length && ctx.hasUI) {
      pasted = [];
      showWidget(ctx);
    }
    return changed ? { action: "transform", text, images } : { action: "continue" };
  });
}
