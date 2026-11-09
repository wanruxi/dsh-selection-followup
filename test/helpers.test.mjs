// Offline checks for the pure helpers in lib/client.js.
//
// No DOM implementation is installed here, so the small surface the helpers
// actually touch (window size, getSelection, closest/getAttribute,
// sessionStorage) is faked. That is enough to pin the decisions that are easy
// to get wrong — quoting, whitespace normalisation, placement clamping, session
// scoping, the card store, and the send-time patch — without booting a browser.
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
  const store = new Map();
  const fakeWindow = {
    innerWidth: 1200,
    innerHeight: 800,
    getSelection: () => null,
    addEventListener() {},
    removeEventListener() {},
    sessionStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  };
  const scope = {
    document: { addEventListener() {}, removeEventListener() {}, body: null },
  };
  globalThis.window = fakeWindow;
  globalThis.document = scope.document;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.__ModuleLoader__ = {
    load(options) {
      const require = (name) => {
        if (name === 'react')
          return {
            createElement: () => null,
            useRef: () => ({}),
            useState: () => [null, () => {}],
            useEffect() {},
            useCallback: (f) => f,
          };
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
    globalThis.requestAnimationFrame,
    globalThis.cancelAnimationFrame,
  );
  return { plugin, window: fakeWindow, store };
}

const { plugin } = load();
const { normalize, asQuote, quoteBlock, composeOutgoing, previewOf, place, offScreen, sessionOf } = plugin.__test;
const { cardsFor, addCard, removeCard, takeCards, restoreCards, subscribe, attachSender, shellFor } = plugin.__test;

test('normalize collapses CRLF, trailing spaces and blank runs', () => {
  assert.equal(normalize('a  \r\nb\r\n\r\n\r\n\r\nc\n\n'), 'a\nb\n\nc');
  assert.equal(normalize('\n\n  x  \n\n'), '  x');
});

test('asQuote prefixes every line and keeps a blank line after', () => {
  assert.equal(asQuote('one\ntwo'), '> one\n> two\n\n');
  assert.equal(asQuote('one\n\ntwo'), '> one\n>\n> two\n\n');
});

test('quoteBlock is the same block quote without the trailing blank line', () => {
  assert.equal(quoteBlock('one\ntwo  '), '> one\n> two');
  assert.equal(quoteBlock('one\n\ntwo'), '> one\n>\n> two');
});

test('composeOutgoing puts the question first and every quote after it', () => {
  assert.equal(composeOutgoing('why?', [{ text: 'a' }]), 'why?\n\n> a');
  assert.equal(composeOutgoing('  ', [{ text: 'a' }]), '> a');
  assert.equal(composeOutgoing('why?', []), 'why?');
  assert.equal(
    composeOutgoing('why?', [{ text: 'a\nb' }, { text: 'c' }]),
    'why?\n\n> a\n> b\n\n> c',
  );
});

test('a quote sent alone is still a well-formed block quote', () => {
  // Markdown lazy continuation only absorbs text directly under a quote line,
  // so the question must never be glued onto the quote without a blank line.
  const outgoing = composeOutgoing('my question', [{ text: 'quoted line' }]);
  assert.deepEqual(outgoing.split('\n'), ['my question', '', '> quoted line']);
});

test('previewOf clips the first line and flags the rest', () => {
  assert.deepEqual(previewOf('short'), { head: 'short', extra: false });
  assert.deepEqual(previewOf('a\nb'), { head: 'a', extra: true });
  const long = previewOf('x'.repeat(200));
  assert.equal(long.head.length, 81);
  assert.ok(long.head.endsWith('…'));
  assert.equal(long.extra, true);
});

test('place keeps the pill on screen near every viewport edge', () => {
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
  }
});

test('place falls back to the selection rect when there is no pointer', () => {
  const at = place(null, { left: 500, top: 400, bottom: 420, width: 100, height: 20 });
  assert.equal(at.top, 400 - 30 - 8);
  assert.equal(at.left, 500 + 50 - 96 / 2);
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

test('cards live per session and leave the draft untouched', () => {
  const before = cardsFor('s1').length;
  const card = addCard('s1', 'one\ntwo  ');
  assert.ok(card && card.id);
  assert.equal(card.text, 'one\ntwo');
  assert.equal(cardsFor('s1').length, before + 1);
  assert.equal(cardsFor('s2').length, 0);
  addCard('s2', 'other');
  assert.equal(cardsFor('s2').length, 1);
  removeCard('s1', card.id);
  assert.equal(cardsFor('s1').length, before);
});

test('an empty selection never becomes a card', () => {
  assert.equal(addCard('s1', '  \n\n '), null);
});

test('a send takes the cards and a failure puts them back', () => {
  const card = addCard('s3', 'kept');
  const batch = takeCards('s3');
  assert.equal(batch.length, 1);
  assert.equal(batch[0].id, card.id);
  assert.equal(cardsFor('s3').length, 0);
  restoreCards('s3', batch);
  assert.equal(cardsFor('s3').length, 1);
});

test('subscribers hear about every change', () => {
  let calls = 0;
  const off = subscribe(() => {
    calls += 1;
  });
  const card = addCard('s4', 'x');
  removeCard('s4', card.id);
  off();
  addCard('s4', 'y');
  assert.equal(calls, 2);
});

/** A shell whose three send-path functions record what they were handed. */
function fakeShell(sessionId) {
  const seen = { sinks: [], defaults: [], failures: 0 };
  const deps = {
    defaultSink(text, attachmentIds, mode, signal) {
      seen.defaults.push({ text, mode, signal });
      return Promise.resolve({ kind: 'success' });
    },
  };
  const shell = {
    deps,
    sinkSerialized(attempt, draft, mode) {
      seen.sinks.push({ draft, mode, signal: attempt && attempt.signal });
      return deps.defaultSink(draft, [], mode, attempt && attempt.signal);
    },
    settleDetachedFailure() {
      seen.failures += 1;
    },
  };
  return { shell, seen, sessionId };
}

test('the patch appends parked quotes to the outgoing text only', async () => {
  const { shell, seen, sessionId } = fakeShell('s5');
  addCard(sessionId, 'quoted  line');
  const release = attachSender(shell, sessionId);
  assert.equal(typeof release, 'function');

  const attempt = { signal: 'sig-1' };
  await shell.sinkSerialized(attempt, 'my question', 'queue');

  assert.equal(seen.sinks[0].draft, 'my question', 'the draft itself is untouched');
  assert.equal(seen.defaults[0].text, 'my question\n\n> quoted  line');
  assert.equal(cardsFor(sessionId).length, 0, 'a successful send consumes the card');
  release();
});

test('a failed send restores the cards instead of losing them', async () => {
  const { shell, sessionId } = fakeShell('s6');
  shell.deps.defaultSink = () => Promise.resolve({ kind: 'failure' });
  const card = addCard(sessionId, 'kept');
  const release = attachSender(shell, sessionId);
  await shell.sinkSerialized({ signal: 'sig-2' }, 'q', 'queue');
  assert.equal(cardsFor(sessionId).length, 1);
  assert.equal(cardsFor(sessionId)[0].id, card.id);
  release();
  removeCard(sessionId, card.id);
});

test('a rejected send restores the cards too', async () => {
  const { shell, sessionId } = fakeShell('s7');
  shell.deps.defaultSink = () => Promise.reject(new Error('offline'));
  const card = addCard(sessionId, 'kept');
  const release = attachSender(shell, sessionId);
  await assert.rejects(shell.sinkSerialized({ signal: 'sig-3' }, 'q', 'queue'), /offline/);
  assert.equal(cardsFor(sessionId).length, 1);
  release();
  removeCard(sessionId, card.id);
});

test('a plain send without cards goes through untouched', async () => {
  const { shell, seen, sessionId } = fakeShell('s8');
  const release = attachSender(shell, sessionId);
  await shell.sinkSerialized({ signal: 'sig-4' }, 'hello', 'queue');
  assert.equal(seen.defaults[0].text, 'hello');
  release();
});

test('releasing the patch restores the shell and returns in-flight cards', () => {
  const { shell, sessionId } = fakeShell('s9');
  const originalSink = shell.sinkSerialized;
  const originalDefault = shell.deps.defaultSink;
  addCard(sessionId, 'pending');
  const release = attachSender(shell, sessionId);
  assert.notEqual(shell.sinkSerialized, originalSink);
  shell.sinkSerialized({ signal: 'sig-5' }, 'q', 'queue');
  release();
  assert.equal(shell.sinkSerialized, originalSink, 'the prototype method is back');
  assert.equal(shell.deps.defaultSink, originalDefault);
  assert.equal(cardsFor(sessionId).length, 1, 'an interrupted send keeps its quote');
  removeCard(sessionId, cardsFor(sessionId)[0].id);
});

test('a shell without the send seam is left alone', () => {
  assert.equal(attachSender(null, 's1'), null);
  assert.equal(attachSender({}, 's1'), null);
  assert.equal(attachSender({ deps: {} }, 's1'), null);
});

test('shellFor only ever reaches services through ctx.get, never a property read', () => {
  // The dynamic client facade hands out a proxy: `ctx.get(name)` is the optional
  // lookup, while `ctx[name]` is gated on the plugin's declared injects and
  // throws (and reports a failure) for anything else. Reading it used to make
  // this whole lookup fail, so the send seam was never patched.
  const hub = { shell: (id) => ({ id }) };
  const root = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'get') return (name) => (name === 'conversation' ? { input: hub } : undefined);
        throw new Error(`service "${String(prop)}" is not declared by your plugin`);
      },
    },
  );
  assert.deepEqual(shellFor(root, 's1'), { id: 's1' });
});

test('shellFor survives a host that has no conversation service', () => {
  assert.equal(shellFor({ get: () => undefined }, 's1'), null);
  assert.equal(shellFor(null, 's1'), null);
  assert.equal(shellFor({ get: () => ({ input: {} }) }, 's1'), null);
});

test('the plugin declares the slots it needs and its locale keys', () => {
  assert.equal(plugin.name, 'dsh-selection-followup');
  // The input hub is looked up lazily: naming it here would make the plugin
  // fail to load on a host that does not hand it out.
  assert.deepEqual(plugin.inject, ['slots', 'locale']);
  assert.equal(typeof plugin.apply, 'function');
  assert.equal(typeof plugin.__test.composeOutgoing, 'function');
});
