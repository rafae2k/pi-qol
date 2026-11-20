"""Render the README images from a real pi session.

Drives pi in a pseudo-terminal, reads the screen with pyte, and draws it as SVG, then PNG through a
headless Chromium-based browser. Terminal emulators that pyte imitates cannot draw inline images, so
the pasted-image thumbnail is placed into the rows pi reserved for it.

Usage (macOS, dev only):
    python3 -m venv .render/venv && .render/venv/bin/pip install pyte
    .render/venv/bin/python scripts/render-demos.py <demo-repo> <session-dir> <image.png>

The demo repo should hold a .pi/settings.json with {"quietStartup": true} and an existing session.
"""

import base64
import fcntl
import html
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time
from pathlib import Path

import re

import pyte

# APC (kitty images) and OSC (hyperlinks, titles): pyte prints the first and eats a character after the second.
APC = re.compile(rb"\x1b_.*?\x1b\\|\x1b\].*?(?:\x07|\x1b\\)", re.S)

COLS, ROWS = 100, 30
CELL_W, CELL_H, FONT = 8.4, 18, 14
PAD, BAR = 18, 34
BG, FG = "#1e1f24", "#d4d4d8"
BROWSER = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
ROOT = Path(__file__).resolve().parent.parent
ANSI = {
    "black": "#3f3f46", "red": "#f87171", "green": "#86efac", "brown": "#fcd34d", "yellow": "#fcd34d",
    "blue": "#93c5fd", "magenta": "#c4b5fd", "cyan": "#67e8f9", "white": "#e4e4e7",
}


class Term:
    def __init__(self, cwd: str, args: list[str]):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(cwd)
            # pyte cannot answer the image-support query; forcing kitty makes pi reserve rows for the thumbnail
            os.environ.update(TERM="xterm-256color", COLORTERM="truecolor", PI_IMAGE_PROTOCOL="kitty")
            os.execvp("pi", ["pi", *args])
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
        self.screen = pyte.Screen(COLS, ROWS)
        self.stream = pyte.ByteStream(self.screen)
        self.pending = b""

    def feed(self, data: bytes):
        # pyte does not know APC sequences and would print kitty image payloads as text: drop them,
        # holding back an unfinished one until its terminator arrives.
        data = APC.sub(b"", self.pending + data)
        cut = max(data.rfind(b"\x1b_"), data.rfind(b"\x1b]"))
        self.pending, data = (data[cut:], data[:cut]) if cut != -1 else (b"", data)
        self.stream.feed(data)

    def pump(self, seconds: float):
        end = time.time() + seconds
        while time.time() < end:
            ready, _, _ = select.select([self.fd], [], [], 0.1)
            if ready:
                try:
                    self.feed(os.read(self.fd, 65536))
                except OSError:
                    return

    def wait_for(self, predicate, timeout: float):
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.5)
            if predicate(self.screen.display):
                return True
        return False

    def send(self, data: bytes, settle: float = 1.0):
        os.write(self.fd, data)
        self.pump(settle)

    def close(self):
        os.kill(self.pid, signal.SIGKILL)


def open_session(repo: str, args: list[str]) -> Term:
    """Starts pi and waits for the pinned summary, trusting the demo folder for this session only."""
    term = Term(repo, args)
    has_header = lambda d: " · " in d[0]  # noqa: E731
    term.wait_for(lambda d: has_header(d) or any("Trust project folder?" in l for l in d), 90)
    if any("Trust project folder?" in l for l in term.screen.display):
        term.send(b"\x1b[B\x1b[B\r", 1)  # "Trust (this session only)"
    if not term.wait_for(has_header, 90):
        term.close()
        sys.exit("the pinned summary never showed up")
    term.pump(2)
    return term


def color(value: str, fallback: str) -> str:
    if value == "default":
        return fallback
    if len(value) == 6 and all(c in "0123456789abcdefABCDEF" for c in value):
        return f"#{value}"
    return ANSI.get(value, fallback)


def svg(screen: pyte.Screen, title: str, rows: range, image: tuple[int, int, int, str] | None = None) -> str:
    width = PAD * 2 + COLS * CELL_W
    height = BAR + PAD + len(rows) * CELL_H + PAD
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">',
        f'<rect width="{width}" height="{height}" rx="12" fill="{BG}"/>',
        f'<rect width="{width}" height="{BAR}" rx="12" fill="#2a2b31"/><rect y="{BAR - 12}" width="{width}" height="12" fill="#2a2b31"/>',
        *(f'<circle cx="{20 + i * 20}" cy="{BAR / 2}" r="6" fill="{c}"/>' for i, c in enumerate(["#ff5f57", "#febc2e", "#28c840"])),
        f'<text x="{width / 2}" y="{BAR / 2 + 5}" fill="#a1a1aa" font-family="-apple-system,Helvetica" font-size="13" text-anchor="middle">{html.escape(title)}</text>',
        f'<g font-family="Menlo,monospace" font-size="{FONT}" style="white-space:pre">',
    ]
    for i, r in enumerate(rows):
        y = BAR + PAD + i * CELL_H
        line = screen.buffer[r]
        col = 0
        while col < COLS:
            ch = line[col]
            fg, bg, bold = color(ch.fg, FG), color(ch.bg, BG), ch.bold
            if ch.reverse:
                fg, bg = bg, fg
            start, text = col, ""
            while col < COLS:
                c = line[col]
                cfg, cbg = color(c.fg, FG), color(c.bg, BG)
                if c.reverse:
                    cfg, cbg = cbg, cfg
                if (cfg, cbg, c.bold) != (fg, bg, bold):
                    break
                text += c.data or " "
                col += 1
            x = PAD + start * CELL_W
            if bg != BG:
                out.append(f'<rect x="{x}" y="{y}" width="{(col - start) * CELL_W}" height="{CELL_H}" fill="{bg}"/>')
            if text.strip():
                weight = ' font-weight="bold"' if bold else ""
                # One x per glyph keeps every character on the terminal grid whatever the font's advance; spaces
                # become no-break spaces, or the browser strips leading ones and shifts the run.
                xs = " ".join(f"{PAD + (start + k) * CELL_W:.1f}" for k in range(len(text)))
                out.append(f'<text x="{xs}" y="{y + CELL_H - 5}" fill="{fg}"{weight}>{html.escape(text).replace(' ', '\u00a0')}</text>')
    out.append("</g>")
    if image:
        row, cols, nrows, href = image
        x, y = PAD + 1 * CELL_W, BAR + PAD + (row - rows.start) * CELL_H
        out.append(f'<image x="{x}" y="{y}" width="{cols * CELL_W}" height="{nrows * CELL_H}" preserveAspectRatio="xMinYMin meet" href="{href}"/>')
    out.append("</svg>")
    return "\n".join(out)


def to_png(svg_text: str, name: str):
    work = ROOT / ".render"
    work.mkdir(exist_ok=True)
    src = work / f"{name}.svg"
    src.write_text(svg_text)
    w = int(float(svg_text.split('width="')[1].split('"')[0]))
    h = int(float(svg_text.split('height="')[1].split('"')[0]))
    page = work / f"{name}.html"
    page.write_text(f'<html><body style="margin:0;background:transparent">{svg_text}</body></html>')
    out = ROOT / "docs" / f"{name}.png"
    subprocess.run(
        [BROWSER, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
         "--default-background-color=00000000", f"--screenshot={out}", f"--window-size={w},{h}", page.as_uri()],
        check=True, capture_output=True, timeout=60,
    )
    print("wrote", out.relative_to(ROOT))


def main():
    repo, sessions, image_path = sys.argv[1], sys.argv[2], sys.argv[3]
    title = f"{Path(repo).name} — pi"
    args = ["--session-dir", sessions, "--continue"]

    term = open_session(repo, args)
    try:
        to_png(svg(term.screen, title, range(ROWS)), "overview")
        to_png(svg(term.screen, title, range(ROWS - 5, ROWS)), "footer")
    finally:
        term.close()

    term = open_session(repo, args)
    try:
        term.send(b"\x1b[200~" + image_path.encode() + b"\x1b[201~", 3)
        term.send(b"same crash on mobile Safari, check this too", 1)
        rows = term.screen.display
        marker = next(i for i, l in enumerate(rows) if l.startswith(" [image 1]"))
        blank = 0
        while marker + 1 + blank < ROWS and not rows[marker + 1 + blank].strip():
            blank += 1
        href = "data:image/png;base64," + base64.b64encode(Path(image_path).read_bytes()).decode()
        to_png(svg(term.screen, title, range(ROWS), (marker + 1, 28, blank, href)), "image-paste")
    finally:
        term.close()


if __name__ == "__main__":
    main()
