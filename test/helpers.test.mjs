// Offline checks for the pure helpers in lib/client.js.
//
// No DOM implementation is installed here, so the small surface the helpers
// actually touch (window size, getSelection, closest/getAttribute) is faked.
// That is enough to pin the decisions that are easy to get wrong — quoting,
// whitespace normalisation, placement clamping and session scoping — without
// booting a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8');

/** Load the browser half into a fake module table and hand back the plugin. */
function load() {
  let plugin = null;
  const fakeWindow = {
    innerWidth: 1200,
    innerHeight: 800,
    getSelection: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  const scope = {
    window: fakeWindow,
    document: { addEventListener() {}, removeEventListener() {}, body: null },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    console,
  };
  globalThis.window = fakeWindow;
  globalThis.document = scope.document;
  globalThis.requestAnimationFrame = scope.requestAnimationFrame;
  globalThis.cancelAnimationFrame = scope.cancelAnimationFrame;
  globalThis.__ModuleLoader__ = {
    load(options) {
      const require = (name) => {
        if (name === 'react') return { createElement: () => null, useRef: () => ({}), useState: () => [null, () => {}], useEffect() {}, useCallback: (f) => f };
        if (name === 'react-dom') return { createPortal: () => null };
        throw new Error('unexpected require: ' + name);
      };
      plugin = options.factory(require);
    },
  };
  fakeWindow.__ModuleLoader__ = globalThis.__ModuleLoader__;
  new Function('window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', source)(
    fakeWindow,
    scope.document,
    scope.requestAnimationFrame,
    scope.cancelAnimationFrame,
  );
  return { plugin, window: fakeWindow };
}

const { plugin } = load();
const { normalize, asQuote, place, offScreen, sessionOf, leadingBreak, quoteInto } = plugin.__test;

test('normalize collapses CRLF, trailing spaces and blank runs', () => {
  assert.equal(normalize('a  \r\nb\r\n\r\n\r\n\r\nc\n\n'), 'a\nb\n\nc');
  assert.equal(normalize('\n\n  x  \n\n'), '  x');
});

test('asQuote prefixes every line and keeps a blank line after', () => {
  assert.equal(asQuote('one\ntwo'), '> one\n> two\n\n');
  assert.equal(asQuote('one\n\ntwo'), '> one\n>\n> two\n\n');
});

test('a follow-up typed behind the quote cannot be swallowed', () => {
  const draft = asQuote('quoted line') + 'my question';
  const lines = draft.split('\n');
  assert.deepEqual(lines, ['> quoted line', '', 'my question']);
  // Markdown lazy continuation only absorbs text directly under a quote line.
  assert.ok(!lines[2].startsWith('>'));
  assert.equal(lines[1], '');
});

test('place keeps the pill on screen near every viewport edge', () => {
  const size = { width: 40, height: 16 };
  const corners = [
    { x: 2, y: 2 },
    { x: 1190, y: 2 },
    { x: 2, y: 790 },
    { x: 1190, y: 790 },
  ];
  for (const anchor of corners) {
    const at = place(anchor, { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
    assert.ok(at.left >= 8, 'left ' + at.left);
    assert.ok(at.top >= 8, 'top ' + at.top);
    assert.ok(at.left + 96 <= 1200 - 8 + 96, 'left edge fits');
    assert.ok(at.top + 30 <= 800 - 8 + 30, 'top edge fits');
  }
});

test('place falls back to the selection rect when there is no pointer', () => {
  const at = place(null, { left: 500, top: 400, bottom: 420, width: 100, height: 20 });
  assert.equal(at.top, 400 - 30 - 8);
  assert.equal(at.left, 500 + 50 - 48);
});

test('place clamps with the measured box, not the first-frame guess', () => {
  const rect = { left: 0, top: 0, bottom: 0, width: 0, height: 0 };
  const wide = place({ x: 1180, y: 300 }, rect, { width: 180, height: 34 }, { width: 1200, height: 800 });
  assert.ok(wide.left + 180 <= 1192, 'wide pill stays inside the right edge');
  const tall = place({ x: 300, y: 780 }, rect, { width: 90, height: 48 }, { width: 1200, height: 800 });
  assert.ok(tall.top + 48 <= 792, 'tall pill stays inside the bottom edge');
});

test('a selection scrolled out of view is not offered', () => {
  const view = { width: 1200, height: 800 };
  assert.equal(offScreen({ left: 0, right: 100, top: -40, bottom: -10 }, view), true);
  assert.equal(offScreen({ left: 0, right: 100, top: 820, bottom: 860 }, view), true);
  assert.equal(offScreen({ left: -200, right: -50, top: 100, bottom: 120 }, view), true);
  assert.equal(offScreen({ left: 100, right: 200, top: 100, bottom: 120 }, view), false);
});

test('sessionOf reads the nearest session scope', () => {
  const scope = { getAttribute: () => 'session-7' };
  const node = { nodeType: 1, closest: (sel) => (sel.includes('data-conversation-session') ? scope : null) };
  assert.equal(sessionOf(node), 'session-7');
  const lonely = { nodeType: 1, closest: () => null };
  assert.equal(sessionOf(lonely), undefined);
});

test('leading break only appears when the caret has text in front of it', () => {
  const at = (start) => ({ captureInsertion: () => ({ start, end: start, draftRev: 1 }), insertText: () => true });
  assert.equal(leadingBreak(at(0), ''), '');
  assert.equal(leadingBreak(at(4), 'abcd'), '\n\n');
  assert.equal(leadingBreak(at(4), 'abc\n'), '\n');
  assert.equal(leadingBreak(at(5), 'abc\n\n'), '');
});

test('quoteInto inserts a reference chip when the host offers a controller', () => {
  const seen = [];
  const actions = {
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
    insertText: () => true,
  };
  const controller = {
    execute: (outcome, span) => {
      seen.push({ outcome, span });
      return true;
    },
  };
  assert.equal(quoteInto(actions, controller, '', 'one\ntwo  ', 'Quote'), 'chip');
  assert.equal(seen.length, 1);
  const reference = seen[0].outcome.insert;
  assert.equal(reference.source, 'selection-followup');
  assert.equal(reference.ref, 'one\ntwo');
  assert.equal(reference.appearance, 'session');
  assert.equal(reference.clipboardText, '> one\n> two\n\n');
  assert.equal(seen[0].span.draftRev, 1);
});

test('quoteInto falls back to a block quote when no controller is available', () => {
  let written = null;
  const actions = {
    captureInsertion: () => ({ draftRev: 1 }),
    insertText: (text) => {
      written = text;
      return true;
    },
    setDraft: () => {
      throw new Error('must not rewrite the draft when the retry succeeds');
    },
  };
  assert.equal(quoteInto(actions, null, '', 'x'), 'text');
  assert.equal(written, '> x\n\n');
});

test('quoteInto retries a stale span before rewriting the draft', () => {
  const calls = [];
  let attempt = 0;
  const actions = {
    captureInsertion: () => ({ draftRev: ++attempt }),
    insertText: (text, span) => {
      calls.push(span.draftRev);
      return span.draftRev === 2; // the first capture is stale
    },
    setDraft: () => {
      throw new Error('must not rewrite the draft when a retry succeeds');
    },
  };
  assert.equal(quoteInto(actions, null, '', 'x'), 'text');
  assert.deepEqual(calls, [1, 2]);
});

test('quoteInto appends when both spans are refused', () => {
  let written = null;
  const actions = {
    captureInsertion: () => null,
    insertText: () => false,
    setDraft: (text) => {
      written = text;
    },
  };
  assert.equal(quoteInto(actions, null, 'existing  \n', 'x'), 'text');
  assert.equal(written, 'existing\n\n> x\n\n');
});

test('quoteInto reports failure instead of pretending', () => {
  const actions = { captureInsertion: () => null, insertText: () => false, setDraft: () => { throw new Error('locked'); } };
  assert.equal(quoteInto(actions, null, '', 'x'), 'failed');
});

test('quoteInto rejects empty selections and a closed composer', () => {
  const actions = { captureInsertion: () => ({ draftRev: 1 }), insertText: () => true };
  assert.equal(quoteInto(actions, null, '', '   \n\n '), 'empty');
  assert.equal(quoteInto({}, null, '', 'x'), 'unavailable');
});

test('the quote source serializes back to the same block quote', async () => {
  const spec = plugin.__test.sourceSpec;
  assert.equal(spec.trigger, '@');
  assert.equal(spec.codec.clipboardText('one\ntwo'), '> one\n> two\n\n');
  assert.equal(await spec.codec.serialize('one\ntwo  '), '> one\n> two\n\n');
});

test('the source name is unique against the neighbouring quote plugin', () => {
  // `@quote` belongs to dsh-quote-to-composer; a second registration throws.
  assert.notEqual(plugin.__test.sourceSpec.name, 'quote');
});

test('the plugin declares the slot it needs and its locale keys', () => {
  assert.equal(plugin.name, 'dsh-selection-followup');
  // The trigger channel is looked up lazily: naming it here would make the
  // plugin fail to load on a host that lacks it.
  assert.deepEqual(plugin.inject, ['slots', 'locale']);
  assert.equal(typeof plugin.apply, 'function');
});
