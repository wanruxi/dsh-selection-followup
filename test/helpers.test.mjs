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
const { normalize, asQuote, place, sessionOf, insert } = plugin.__test;

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

test('sessionOf reads the nearest session scope', () => {
  const scope = { getAttribute: () => 'session-7' };
  const node = { nodeType: 1, closest: (sel) => (sel.includes('data-conversation-session') ? scope : null) };
  assert.equal(sessionOf(node), 'session-7');
  const lonely = { nodeType: 1, closest: () => null };
  assert.equal(sessionOf(lonely), undefined);
});

test('insert retries a stale span before rewriting the draft', () => {
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
  assert.equal(insert(actions, '', '> x\n\n'), true);
  assert.deepEqual(calls, [1, 2]);
});

test('insert falls back to appending when both spans are refused', () => {
  let written = null;
  const actions = {
    captureInsertion: () => null,
    insertText: () => false,
    setDraft: (text) => {
      written = text;
    },
  };
  assert.equal(insert(actions, 'existing  \n', '> x\n\n'), true);
  assert.equal(written, 'existing\n\n> x\n\n');
});

test('insert reports failure instead of pretending', () => {
  const actions = { captureInsertion: () => null, insertText: () => false, setDraft: () => { throw new Error('locked'); } };
  assert.equal(insert(actions, '', '> x\n\n'), false);
});

test('the plugin declares the slot it needs and its locale keys', () => {
  assert.equal(plugin.name, 'dsh-selection-followup');
  assert.deepEqual(plugin.inject, ['slots', 'locale']);
  assert.equal(typeof plugin.apply, 'function');
});
