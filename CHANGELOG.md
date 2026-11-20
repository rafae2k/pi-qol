# Changelog

## 0.1.1

- session-header: when the configured `summaryModel` fails (quota, outage), the summary falls back to the session's model and skips the configured one for 5 minutes. A reply that ends in a provider error now counts as a failure.

## 0.1.0

- session-header: pinned title and summary, sized to 3 rows at the terminal's width, refreshed every few messages, saved in the session, names the session. `/summary` and `/id`.
- compact-footer: two-line footer with folder, branch, context, model, thinking level and extension status.
- image-paste: `Cmd+V` of an image path and `Ctrl+V` (macOS) insert a marker and show a thumbnail; markers and image paths become attachments on send.
