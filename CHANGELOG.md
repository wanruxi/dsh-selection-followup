# Changelog

## 0.2.0

- The pill now appears next to the pointer when the selection came from the
  mouse, and above the selection for keyboard selections. It flips above the
  pointer near the bottom edge and to the left near the right edge, so it is
  always fully on screen.
- `Ctrl+Shift+Q` quotes the current selection without the mouse. Ctrl only, on
  every platform — `Cmd+Shift+Q` is macOS "log out".
- `Esc` dismisses the pill.
- Insertion retries with a fresh span when the draft revision moved between
  capture and edit, instead of dropping straight to a full draft rewrite.
- Selected text is normalized before quoting: CRLF collapsed, trailing spaces
  and runs of blank lines removed, so a quote never carries ragged whitespace.
- Long selections report themselves in the tooltip instead of truncating
  silently.

## 0.1.0

- First release.
- Floating **追问** pill above a non-empty text selection in the conversation.
- Inserts the selection into the composer as a Markdown block quote, as one
  undoable edit via `InputActions.captureInsertion()` + `insertText()`.
- Skips editable fields and its own DOM, truncates selections over 8,000
  characters.
