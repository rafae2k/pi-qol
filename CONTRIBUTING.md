# Contributing

## Setup

You need Node 24 or newer and pnpm.

```bash
pnpm install
pnpm check   # typecheck, lint and tests
```

To try your changes in pi without an installed copy getting in the way:

```bash
pi --no-extensions -e .
```

Add `-e <path to your provider extension>` if your model comes from one, such as pi-claude-bridge.

## Layout

| Path          | Contents                                                                      |
| ------------- | ----------------------------------------------------------------------------- |
| `extensions/` | The three entry points pi loads: events, commands and UI wiring               |
| `src/`        | Logic that doesn't need a running pi: summaries, key sequences, paths, footer |
| `test/`       | Tests for `src/`, run with `node --test`                                      |
| `scripts/`    | The README image renderer and the demo page it pastes                         |

## Pull requests

- Keep logic in `src/` with a test, and keep `extensions/` thin.
- A failure in an accessory feature (summary, thumbnail) warns the user and carries on; it never breaks the session.
- Run `pnpm check` before opening the PR.

## README images

The images in `docs/` come from a real session (macOS, needs a Chromium-based browser for SVG to PNG):

```bash
python3 -m venv .render/venv && .render/venv/bin/pip install pyte
.render/venv/bin/python scripts/render-demos.py <demo-repo> <session-dir> <image.png>
```

The demo repo needs a `.pi/settings.json` with `{"quietStartup": true}` and a conversation in `<session-dir>`. Edit the browser path at the top of the script if you don't use Brave.
