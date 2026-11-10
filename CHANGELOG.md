# Changelog

## 0.5.0

- **Renamed to `dsh-quote-tray`.** The old package name `dsh-selection-followup`
  was already taken on npm and by another Harness plugin, so the two could never
  be installed side by side and every listing had to carry a collision warning.
  The bundle id, slot ids, `data-` attributes, storage key and console tag all
  moved with it. Nothing else changed: the behaviour is what 0.4.2 shipped.
- Installing this version replaces the old one; remove `dsh-selection-followup`
  from the profile first if it is still listed there.

## 0.4.2

- **Fixed: quotes never reached the model.** The send hook was looked up with a
  property read (`ctx.conversation`), and the dynamic client facade only allows
  that for services named in the plugin's `inject` — it throws for anything else.
  The throw was swallowed, the lookup returned null, and the three-point send
  patch was silently never installed, so cards were cleared with the draft and
  the message went out bare. The lookup now goes through `ctx.get('conversation')`,
  the optional channel the facade exposes without a declaration.
- Each door into the input hub is now guarded separately, so a session whose
  binding is not retained yet falls through to the other door instead of
  abandoning the whole lookup.
- The hook retries for about five seconds while the dock mounts ahead of the
  session binding, and warns once in the console if it still cannot hook the
  compose box — a missing send path no longer fails silently.

## 0.4.1

- The quote cards now line up with the composer card instead of sitting flush
  against the window edge. The dock spans the whole column while the composer is
  an inset, centred box, so the cards rebuild the host's own two rules —
  `--dsh-composer-side-clearance` as padding and `--dsh-composer-card-max-width`
  as the cap. Measured against the composer in four widths (1200, 700, and the
  embedded 600 / 360 variants): both edges match to the pixel.

## 0.4.0

- The quote no longer enters the composer at all. Selecting text and clicking the
  pill parks the passage as a **card above the input box**, and the box keeps
  only the question you type — the ChatGPT / Codex shape.
- Cards can be removed one by one with the `×` on each card, and they survive a
  reload (mirrored into `sessionStorage`, kept per session).
- At send time each parked quote is appended to the outgoing message as a
  Markdown block quote. The host exposes no "extra context" channel, so the last
  mile is a three-point patch of that session's input shell
  (`sinkSerialized`, `settleDetachedFailure`, `deps.defaultSink`). All three are
  patched or none: a partial patch would either send a quote twice or drop it.
- A failed or rejected send puts the quotes back on the cards instead of losing
  them, and unmounting the composer restores the untouched shell methods.
- The reference-chip route from 0.3.0 is gone, along with its `@selection-followup`
  source and codec. Nothing is inserted into the draft any more, so that channel
  is not needed.
- Cards render in `conversation.input.dock`, directly above the composer card.

## 0.3.0

- The quote now lands in the composer as a **reference card** — the same node the
  `@` file mention uses — instead of a run of `> ` text. The card is visible and
  removable, and the model still receives the original quoted lines.
- The plugin registers its own reference source (`@selection-followup`) together
  with a codec. A source without a codec makes every send that carries the card
  fail with `no serializer for reference source`, so the two always ship as one.
- The insertion point is nudged onto a fresh paragraph before the card goes in,
  because Markdown lazy continuation would otherwise absorb the quote into the
  paragraph above it.
- Plain block-quote insertion is kept as the fallback for hosts that expose no
  trigger controller for the session, so the pill never turns into a dead click.
- `quoteInto()` reports `chip` / `text` / `failed` / `empty` / `unavailable`, and
  the tests pin each of those outcomes plus the codec round trip.

## 0.2.1

- The pill is clamped by its measured box instead of a hard-coded 96×30 guess,
  so a longer label in another language no longer pushes it off the right or
  bottom edge.
- A successful quote leaves a short "已引用 / Quoted" receipt where the pill was.
  It is pointer-transparent, so it never blocks the click that follows.
- Double commits are refused: a second click or `Ctrl+Shift+Q` while the first
  insertion is still running cannot insert the same selection twice.
- A selection scrolled out of the viewport no longer offers a pill pinned to the
  screen edge — the reader cannot see what would be quoted.
- Scrolling clears the stored pointer anchor, so the pill stops claiming to sit
  next to a pointer that is no longer over the selection.
- The pill re-places itself only when its measured size actually changes, not on
  every render.

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
