/**
 * Pure helpers for image pasting: terminal key sequences, pasted paths and markers.
 * Nothing here touches the file system or the clipboard.
 */

export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

// pi turns on the kitty keyboard protocol with key-release reporting (flags 7), so one Ctrl+V arrives
// twice: pressed (":1" or no event type) and released (":3"). Only the press may count.
const CTRL_V = /^(?:\x16|\x1b\[118(?::\d+)*;5(?::1)?u)$/;
const BACKSPACE = /^(?:\x7f|\x08|\x1b\[127(?:;1)?(?::1)?u)$/;
const KEY_RELEASE = /^\x1b\[[\d:;]*:3[u~A-Z]$/;

export const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i;
// Starts a line or follows whitespace, ends at the first image extension: "a.png and /b.png" is two paths.
const PATH_IN_TEXT = /(^|\s)(['"]?)((?:~\/|\/)[^\n'"]*?\.(?:png|jpe?g|gif|webp))\2(?=$|\s|[,;:!?)])/gim;

export const isCtrlVPress = (data: string) => CTRL_V.test(data);
export const isBackspacePress = (data: string) => BACKSPACE.test(data);
export const isKeyRelease = (data: string) => KEY_RELEASE.test(data);

/** Sequences that may move the cursor away from the end of the draft: arrows, Home, Ctrl+A... */
export function mayMoveCursor(data: string): boolean {
  if (data.startsWith(PASTE_START)) return false;
  if (data.startsWith("\x1b")) return true;
  return data.length === 1 && data.charCodeAt(0) < 32 && data !== "\r";
}

/** Content of a complete bracketed paste, or null. */
export function unwrapBracketedPaste(data: string): string | null {
  if (!data.startsWith(PASTE_START) || !data.endsWith(PASTE_END)) return null;
  return data.slice(PASTE_START.length, -PASTE_END.length);
}

/** Unescapes "\ " and expands "~/". */
export function normalizePath(raw: string, home: string): string {
  const unescaped = raw.trim().replace(/\\ /g, " ");
  return unescaped.startsWith("~/") ? home + unescaped.slice(1) : unescaped;
}

/** The pasted text when it is exactly one image path (optionally quoted), else null. */
export function parsePastedImagePath(text: string, home: string): string | null {
  const t = text.trim();
  if (!t || t.includes("\n")) return null;
  const quoted = t.match(/^(['"])(.+)\1$/);
  const path = normalizePath(quoted ? quoted[2] : t, home);
  if (!path.startsWith("/") || !IMAGE_EXTENSION.test(path)) return null;
  return path;
}

/** Image paths written anywhere in a message. `raw` is the exact text to replace. */
export function findImagePaths(text: string, home: string): Array<{ raw: string; path: string }> {
  return [...text.matchAll(PATH_IN_TEXT)].map((m) => ({ raw: m[2] + m[3] + m[2], path: normalizePath(m[3], home) }));
}

export const markerFor = (n: number) => `[image ${n}]`;

/** The trailing marker (with its trailing space, if any) to delete on Backspace, or null. */
export function trailingMarker(text: string, markers: readonly string[]): string | null {
  for (const marker of markers) {
    for (const tail of [`${marker} `, marker]) if (text.endsWith(tail)) return tail;
  }
  return null;
}
