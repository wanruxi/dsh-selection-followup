# Changelog

## 0.1.0

- First release.
- Floating **追问** pill above a non-empty text selection in the conversation.
- Inserts the selection into the composer as a Markdown block quote, as one
  undoable edit via `InputActions.captureInsertion()` + `insertText()`.
- Skips editable fields and its own DOM, truncates selections over 8,000
  characters.
