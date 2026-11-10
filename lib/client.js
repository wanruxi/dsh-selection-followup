// Client half of dsh-quote-tray.
//
// Select any text in the web GUI and a small "追问" pill appears next to the
// pointer; clicking it (or pressing Ctrl+Shift+Q) parks the selection as a
// quote card above the composer. The composer itself only ever holds the
// question the user typed — the quoted text is appended to the outgoing
// message at send time, right before the host hands it to the session.
//
// The host has no public "extra context" channel, so the last mile is a
// three-point patch of the session's input shell (`sinkSerialized`,
// `settleDetachedFailure`, `deps.defaultSink`). Every patch is reversible and
// is undone when the composer for that session unmounts.
window.__ModuleLoader__.load({
  id: 'dsh-quote-tray',
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var ReactDOM = require('react-dom');

    var NS = 'dsh-quote-tray';
    var OVERLAY_SLOT = 'conversation.input.overlay';
    var OVERLAY_ID = 'quote-tray';
    var DOCK_SLOT = 'conversation.input.dock';
    var DOCK_ID = 'quote-tray-cards';
    var STORAGE_KEY = 'dsh-quote-tray.cards.v1';

    /** First-frame estimate; the rendered pill reports its real box right after. */
    var PILL_HEIGHT = 30;
    var PILL_WIDTH = 96;
    /** Upper bound so selecting a whole page cannot attach megabytes of text. */
    var MAX_CHARS = 8000;
    /** How long the confirmation pill stays up after a quote is parked. */
    var FLASH_MS = 900;
    /** Characters of a quote shown on its card before it is clipped. */
    var PREVIEW_CHARS = 80;

    var SESSION_ATTR = 'data-conversation-session';

    var zh = {
      'action.ask': '追问',
      'action.askTip': '把选中的内容作为引用放在输入框上方，再接着提问（Ctrl+Shift+Q）',
      'action.askTipLong': '选中内容过长，只会引用前 8000 个字符（Ctrl+Shift+Q）',
      'action.done': '已引用',
      'card.remove': '删除这条引用',
      'card.label': '引用',
      'card.more': '…还有更多',
    };
    var en = {
      'action.ask': 'Ask',
      'action.askTip': 'Park the selection as a quote above the composer, then ask (Ctrl+Shift+Q)',
      'action.askTipLong': 'Selection is long; only the first 8000 characters are quoted (Ctrl+Shift+Q)',
      'action.done': 'Quoted',
      'card.remove': 'Remove this quote',
      'card.label': 'Quote',
      'card.more': '…and more',
    };

    /**
     * Only the first mounted composer owns the page-level listeners: the pill is
     * a single floating object, and duplicating the listener set would just fight
     * over where to draw it. `mine()` keeps it from quoting across sessions.
     */
    var owner = null;

    function elementOf(node) {
      if (!node) return null;
      return node.nodeType === 1 ? node : node.parentElement;
    }

    function isOurs(node) {
      var el = elementOf(node);
      return !!(el && el.closest && el.closest('[data-dsh-quote-tray]'));
    }

    function isEditable(node) {
      var el = elementOf(node);
      if (!el || typeof el.closest !== 'function') return false;
      return !!el.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [data-dsh-quote-tray]',
      );
    }

    /**
     * The session a selection belongs to, when the shell marks its DOM. Several
     * sessions can be on screen at once (side conversations), and a quote must
     * land above the composer it was selected in, not the first one that mounted.
     */
    function sessionOf(node) {
      var el = elementOf(node);
      if (!el || typeof el.closest !== 'function') return undefined;
      var scope = el.closest('[' + SESSION_ATTR + ']');
      return scope ? scope.getAttribute(SESSION_ATTR) || undefined : undefined;
    }

    /** Trailing spaces and runs of blank lines are noise inside a block quote. */
    function normalize(text) {
      return String(text)
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+|\n+$/g, '');
    }

    function asQuote(text) {
      var body = String(text)
        .split('\n')
        .map(function (line) {
          return line.length > 0 ? '> ' + line : '>';
        })
        .join('\n');
      return body + '\n\n';
    }

    /** One quote as it reaches the model: a Markdown block quote, no trailing blanks. */
    function quoteBlock(text) {
      return asQuote(normalize(text)).replace(/\n+$/, '');
    }

    /**
     * The question first, then every parked quote, one blank line apart. The
     * shell already trimmed the question by the time this runs, so an empty
     * question simply means the message opens with the quote.
     */
    function composeOutgoing(text, batch) {
      var parts = [];
      var head = String(text == null ? '' : text).trim();
      if (head) parts.push(head);
      var list = Array.isArray(batch) ? batch : [];
      for (var i = 0; i < list.length; i += 1) {
        var block = quoteBlock(list[i] && list[i].text ? list[i].text : '');
        if (block) parts.push(block);
      }
      return parts.join('\n\n');
    }

    /** First line or so, for the card face; the full text still goes to the model. */
    function previewOf(text) {
      var body = normalize(text);
      var first = body.split('\n')[0] || '';
      var lines = body.split('\n').length;
      var clipped = first.length > PREVIEW_CHARS;
      var head = clipped ? first.slice(0, PREVIEW_CHARS) + '…' : first;
      return { head: head, extra: clipped || lines > 1 };
    }

    /**
     * Nearest to the pointer when the selection came from the mouse. `size` is
     * the pill's measured box once it has rendered; the constants are only the
     * first-frame estimate, and a two-character label is far narrower than
     * "Quoted" in English.
     */
    function place(anchor, rect, size, view) {
      var box = size || { width: PILL_WIDTH, height: PILL_HEIGHT };
      var vw = (view && view.width) || window.innerWidth;
      var vh = (view && view.height) || window.innerHeight;
      var w = box.width;
      var h = box.height;
      var x;
      var y;
      if (anchor && typeof anchor.x === 'number') {
        x = anchor.x + 14;
        y = anchor.y + 16;
        if (y + h > vh - 8) y = anchor.y - 16 - h;
        if (x + w > vw - 8) x = anchor.x - 14 - w;
      } else {
        x = rect.left + rect.width / 2 - w / 2;
        y = rect.top - h - 8;
        if (y < 8) y = rect.bottom + 8;
      }
      var maxX = vw - w - 8;
      var maxY = vh - h - 8;
      if (x > maxX) x = maxX;
      if (x < 8) x = 8;
      if (y > maxY) y = maxY;
      if (y < 8) y = 8;
      return { top: y, left: x };
    }

    /**
     * A selection can stay alive while the transcript scrolls it away. Pinning
     * the pill to the viewport edge would then offer to quote something the
     * reader can no longer see.
     */
    function offScreen(rect, view) {
      var vw = (view && view.width) || window.innerWidth;
      var vh = (view && view.height) || window.innerHeight;
      if (!rect) return true;
      return rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw;
    }

    function probe(anchor, size) {
      var selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
      var raw = selection.toString();
      if (!raw || raw.replace(/\s+/g, '') === '') return null;
      var range = selection.getRangeAt(0);
      if (isOurs(range.startContainer) || isOurs(range.endContainer)) return null;
      if (isEditable(range.startContainer) || isEditable(range.endContainer)) return null;
      var rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;
      if (offScreen(rect)) return null;

      var text = normalize(raw);
      if (!text) return null;
      var truncated = text.length > MAX_CHARS;
      if (truncated) text = text.slice(0, MAX_CHARS) + '…';
      return {
        text: text,
        truncated: truncated,
        session: sessionOf(range.startContainer),
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        at: place(anchor, rect, size),
      };
    }

    // ---------------------------------------------------------------- the store
    //
    // Cards sit outside the composer, so nothing in the draft changes when one is
    // added or removed. They are kept per session and mirrored into
    // sessionStorage so a reload does not silently drop something the reader
    // meant to send.

    var cardsBySession = Object.create(null);
    var subscribers = [];
    var cardSeq = 0;
    var loaded = false;

    function storage() {
      try {
        return window.sessionStorage || null;
      } catch (error) {
        return null;
      }
    }

    function readStored() {
      var box = storage();
      if (!box) return;
      try {
        var raw = box.getItem(STORAGE_KEY);
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        for (var id in parsed) {
          var list = parsed[id];
          if (!Array.isArray(list)) continue;
          var kept = [];
          for (var i = 0; i < list.length; i += 1) {
            var card = list[i];
            if (card && typeof card.text === 'string' && card.text) kept.push({ id: String(card.id || ''), text: card.text });
          }
          if (kept.length) cardsBySession[id] = kept;
        }
      } catch (error) {
        /* a corrupt entry must not stop the composer from working */
      }
    }

    function persist() {
      var box = storage();
      if (!box) return;
      try {
        box.setItem(STORAGE_KEY, JSON.stringify(cardsBySession));
      } catch (error) {
        /* quota or a locked-down profile: keep the in-memory copy */
      }
    }

    function emit() {
      persist();
      var list = subscribers.slice();
      for (var i = 0; i < list.length; i += 1) {
        try {
          list[i]();
        } catch (error) {
          /* one bad subscriber must not silence the others */
        }
      }
    }

    function ensureLoaded() {
      if (loaded) return;
      loaded = true;
      readStored();
    }

    function cardsFor(sessionId) {
      ensureLoaded();
      var key = String(sessionId == null ? '' : sessionId);
      return cardsBySession[key] ? cardsBySession[key].slice() : [];
    }

    function addCard(sessionId, text) {
      ensureLoaded();
      var body = normalize(text);
      if (!body) return null;
      var key = String(sessionId == null ? '' : sessionId);
      var card = { id: 'q' + Date.now().toString(36) + '-' + (cardSeq += 1).toString(36), text: body };
      if (!cardsBySession[key]) cardsBySession[key] = [];
      cardsBySession[key].push(card);
      emit();
      return card;
    }

    function removeCard(sessionId, cardId) {
      ensureLoaded();
      var key = String(sessionId == null ? '' : sessionId);
      var list = cardsBySession[key];
      if (!list) return false;
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].id === cardId) {
          list.splice(i, 1);
          if (!list.length) delete cardsBySession[key];
          emit();
          return true;
        }
      }
      return false;
    }

    /** Lifts every pending quote so a send can carry them; a failure puts them back. */
    function takeCards(sessionId) {
      ensureLoaded();
      var key = String(sessionId == null ? '' : sessionId);
      var list = cardsBySession[key];
      if (!list || !list.length) return [];
      var batch = list.slice();
      delete cardsBySession[key];
      emit();
      return batch;
    }

    function restoreCards(sessionId, batch) {
      if (!batch || !batch.length) return;
      ensureLoaded();
      var key = String(sessionId == null ? '' : sessionId);
      var list = cardsBySession[key] || (cardsBySession[key] = []);
      cardsBySession[key] = batch.concat(list);
      emit();
    }

    function subscribe(fn) {
      ensureLoaded();
      subscribers.push(fn);
      return function () {
        var at = subscribers.indexOf(fn);
        if (at >= 0) subscribers.splice(at, 1);
      };
    }

    // ------------------------------------------------------- the send-time patch
    //
    // The host only serializes chips into the prompt; there is no hook for extra
    // text. Patching the three functions the send path goes through is the one
    // seam that leaves the draft untouched: `sinkSerialized` fires once per
    // attempt, `deps.defaultSink` receives the final question, and
    // `settleDetachedFailure` is the host telling us the attempt died.

    var PATCHED = typeof WeakMap === 'function' ? new WeakMap() : null;

    /** Defines an own property over a prototype method and can take it back off. */
    function patch(target, key, value) {
      try {
        var previous = Object.getOwnPropertyDescriptor(target, key);
        Object.defineProperty(target, key, {
          value: value,
          configurable: true,
          writable: true,
          enumerable: previous ? !!previous.enumerable : false,
        });
        return function () {
          try {
            if (previous) Object.defineProperty(target, key, previous);
            else delete target[key];
          } catch (error) {
            /* the shell is already gone */
          }
        };
      } catch (error) {
        return null;
      }
    }

    /**
     * Park the send path of one composer so pending quotes ride along. Returns a
     * disposer, or null when this host's shell does not expose the seam.
     */
    function attachSender(shell, sessionId) {
      if (!shell || !sessionId) return null;
      if (typeof shell.sinkSerialized !== 'function' || typeof shell.settleDetachedFailure !== 'function') return null;
      var deps = shell.deps;
      if (!deps || typeof deps.defaultSink !== 'function') return null;
      if (PATCHED && PATCHED.has(shell)) return null;

      var flights = new Map();
      // The originals are captured before the patch, or the wrappers would call
      // themselves through the property they just replaced.
      var originalSink = shell.sinkSerialized;
      var originalFail = shell.settleDetachedFailure;
      var originalDefault = deps.defaultSink;

      function finish(signal, ok) {
        var batch = flights.get(signal);
        if (!batch) return;
        flights.delete(signal);
        if (!ok) restoreCards(sessionId, batch);
      }

      var wrappedSink = function (attempt) {
        try {
          var batch = takeCards(sessionId);
          if (batch.length) flights.set(attempt ? attempt.signal : undefined, batch);
        } catch (error) {
          /* quoting is best-effort; the send itself must not fail because of it */
        }
        return originalSink.apply(this, arguments);
      };

      var wrappedFail = function (attempt) {
        try {
          if (attempt) finish(attempt.signal, false);
        } catch (error) {
          /* ignore */
        }
        return originalFail.apply(this, arguments);
      };

      var wrappedDefault = function (text, attachmentIds, mode, signal) {
        var batch = flights.get(signal);
        if (!batch || !batch.length) return originalDefault.apply(this, arguments);
        var outgoing = composeOutgoing(text, batch);
        var result = originalDefault.call(this, outgoing, attachmentIds, mode, signal);
        if (result && typeof result.then === 'function') {
          return result.then(
            function (value) {
              finish(signal, !!(value && value.kind === 'success'));
              return value;
            },
            function (error) {
              finish(signal, false);
              throw error;
            },
          );
        }
        finish(signal, true);
        return result;
      };

      var undo = [
        patch(shell, 'sinkSerialized', wrappedSink),
        patch(shell, 'settleDetachedFailure', wrappedFail),
        patch(deps, 'defaultSink', wrappedDefault),
      ];
      // A partial patch would send quotes twice or drop them on failure, so a
      // host that refuses any one of the three gets none of them.
      if (undo.some(function (fn) {
        return !fn;
      })) {
        undo.forEach(function (fn) {
          if (fn) fn();
        });
        return null;
      }
      if (PATCHED) PATCHED.set(shell, true);

      var released = false;
      return function () {
        if (released) return;
        released = true;
        if (PATCHED) PATCHED.delete(shell);
        undo.forEach(function (fn) {
          fn();
        });
        // Anything still in flight belongs back on the cards, not in the void.
        flights.forEach(function (batch, signal) {
          restoreCards(sessionId, batch);
          flights.delete(signal);
        });
      };
    }

    /** The composer shell of one session, through whichever door the host opens. */
    function shellFor(root, sessionId) {
      if (!root || !sessionId) return null;
      var get = typeof root.get === 'function' ? root.get : null;
      if (!get) return null;
      var hub;
      try {
        // ctx.get() is the optional lookup; reading ctx.conversation as a property is
        // only allowed for declared injects and throws (and reports) otherwise.
        var conversation = get('conversation');
        hub = conversation && conversation.input;
      } catch (error) {
        return null;
      }
      if (!hub) return null;
      // Either door may refuse this session; a closed door must not skip the other.
      if (typeof hub.shell === 'function') {
        try {
          var direct = hub.shell(sessionId);
          if (direct) return direct;
        } catch (error) {
          /* no binding yet */
        }
      }
      if (typeof hub.for === 'function') {
        try {
          var sessions = get('sessions');
          if (sessions && typeof sessions.binding === 'function') {
            var binding = sessions.binding(sessionId);
            if (binding && binding.ctx) return hub.for(binding.ctx) || null;
          }
        } catch (error) {
          /* the scope is not retained yet */
        }
      }
      return null;
    }

    var triggerStyle = {
      position: 'fixed',
      zIndex: 2147483000,
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      height: PILL_HEIGHT + 'px',
      padding: '0 11px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
      fontFamily: 'inherit',
      fontSize: '12px',
      lineHeight: 1,
      cursor: 'pointer',
      pointerEvents: 'auto',
      userSelect: 'none',
      whiteSpace: 'nowrap',
    };

    /** The confirmation is a receipt, not a control: it must not eat clicks. */
    var flashStyle = Object.assign({}, triggerStyle, {
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'default',
      pointerEvents: 'none',
      opacity: '0.92',
    });

    function SelectionFollowup(props) {
      var t = props.translate;
      var mySession = typeof props.sessionId === 'string' ? props.sessionId : undefined;

      var tokenRef = React.useRef(null);
      if (tokenRef.current === null) tokenRef.current = {};
      var activeState = React.useState(false);
      var active = activeState[0];
      var setActive = activeState[1];
      var spotState = React.useState(null);
      var spot = spotState[0];
      var setSpot = spotState[1];
      var flashState = React.useState(null);
      var flash = flashState[0];
      var setFlash = flashState[1];

      var spotRef = React.useRef(null);
      spotRef.current = spot;
      /** The pointer position of the last mouse selection, or null. */
      var anchorRef = React.useRef(null);
      var sessionRef = React.useRef(undefined);
      sessionRef.current = mySession;
      /** Real rendered box, so the pill is clamped by what is on screen. */
      var sizeRef = React.useRef(null);
      var settleRef = React.useRef(null);
      var flashTimer = React.useRef(0);
      var busyRef = React.useRef(false);

      var measure = React.useCallback(function (node) {
        if (!node) return;
        var box = node.getBoundingClientRect();
        if (!box || box.width === 0) return;
        var prev = sizeRef.current;
        var next = { width: box.width, height: box.height };
        if (prev && Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5) return;
        sizeRef.current = next;
        if (settleRef.current) settleRef.current();
      }, []);

      var commit = React.useCallback(
        function (forcedText) {
          if (busyRef.current) return false;
          var current = spotRef.current;
          var text = typeof forcedText === 'string' ? forcedText : current ? current.text : '';
          if (!text) return false;
          var at = current ? current.at : null;
          var session = current ? current.session : undefined;
          if (!session) session = sessionRef.current;
          if (!session) return false;
          busyRef.current = true;
          var added = null;
          try {
            added = addCard(session, text);
          } finally {
            busyRef.current = false;
          }
          if (!added) return false;
          var selection = window.getSelection();
          if (selection) selection.removeAllRanges();
          anchorRef.current = null;
          setSpot(null);
          if (at) {
            setFlash({ at: at });
            if (flashTimer.current) clearTimeout(flashTimer.current);
            flashTimer.current = setTimeout(function () {
              flashTimer.current = 0;
              setFlash(null);
            }, FLASH_MS);
          }
          return true;
        },
        [],
      );
      var commitRef = React.useRef(commit);
      commitRef.current = commit;

      React.useEffect(function () {
        if (owner !== null) return undefined;
        owner = tokenRef.current;
        setActive(true);

        var frame = 0;
        /** A selection made in another session must not quote into this one. */
        function mine(next) {
          if (!next) return null;
          var own = sessionRef.current;
          if (next.session && own && next.session !== own) return null;
          return next;
        }
        function settle() {
          frame = 0;
          var next = mine(probe(anchorRef.current, sizeRef.current));
          setSpot(function (prev) {
            if (!next) return null;
            if (
              prev &&
              prev.text === next.text &&
              prev.truncated === next.truncated &&
              prev.at.top === next.at.top &&
              prev.at.left === next.at.left
            ) {
              return prev;
            }
            return next;
          });
        }
        settleRef.current = settle;
        function schedule() {
          if (frame) return;
          frame = requestAnimationFrame(settle);
        }

        function onPointerUp(event) {
          if (event.button !== 0) return;
          anchorRef.current = { x: event.clientX, y: event.clientY };
          schedule();
        }
        function onKeyDown(event) {
          if (!event) return;
          if (event.key === 'Escape') {
            anchorRef.current = null;
            setSpot(null);
            return undefined;
          }
          // Ctrl only on every platform: Cmd+Shift+Q is macOS "log out".
          if (!event.ctrlKey || event.metaKey || !event.shiftKey || event.altKey) return undefined;
          var key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
          if (key !== 'q' && event.code !== 'KeyQ') return undefined;
          var found = mine(probe(null, sizeRef.current));
          if (!found) return undefined;
          try {
            event.preventDefault();
            event.stopPropagation();
          } catch (error) {
            /* keep going */
          }
          commitRef.current(found.text);
          return undefined;
        }
        function onKeyTyping() {
          anchorRef.current = null;
          schedule();
        }
        /** The pointer no longer means anything once the page moves. */
        function onScroll() {
          anchorRef.current = null;
          schedule();
        }

        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('selectionchange', schedule);
        document.addEventListener('mouseup', schedule);
        document.addEventListener('keyup', onKeyTyping);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        return function () {
          if (frame) cancelAnimationFrame(frame);
          if (flashTimer.current) {
            clearTimeout(flashTimer.current);
            flashTimer.current = 0;
          }
          document.removeEventListener('pointerup', onPointerUp, true);
          document.removeEventListener('selectionchange', schedule);
          document.removeEventListener('mouseup', schedule);
          document.removeEventListener('keyup', onKeyTyping);
          document.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onScroll);
          if (owner === tokenRef.current) owner = null;
          settleRef.current = null;
          anchorRef.current = null;
          setSpot(null);
          setFlash(null);
        };
      }, []);

      if (!active) return null;
      if (!spot && !flash) return null;

      if (flash && !spot) {
        return ReactDOM.createPortal(
          React.createElement(
            'div',
            {
              key: 'flash',
              'data-dsh-quote-tray': '',
              role: 'status',
              'aria-live': 'polite',
              style: Object.assign({}, flashStyle, { top: flash.at.top + 'px', left: flash.at.left + 'px' }),
            },
            React.createElement('span', { 'aria-hidden': 'true', style: { fontSize: '13px' } }, '✓'),
            React.createElement('span', null, t('action.done')),
          ),
          document.body,
        );
      }

      return ReactDOM.createPortal(
        React.createElement(
          'button',
          {
            type: 'button',
            ref: measure,
            'data-dsh-quote-tray': '',
            title: t(spot.truncated ? 'action.askTipLong' : 'action.askTip'),
            'aria-label': t('action.askTip'),
            'aria-keyshortcuts': 'Control+Shift+Q',
            onMouseDown: function (event) {
              event.preventDefault();
            },
            onClick: function () {
              commit();
            },
            style: Object.assign({}, triggerStyle, { top: spot.at.top + 'px', left: spot.at.left + 'px' }),
          },
          React.createElement('span', { key: 'glyph', 'aria-hidden': 'true', style: { fontSize: '13px' } }, '❞'),
          React.createElement('span', { key: 'label' }, t('action.ask')),
        ),
        document.body,
      );
    }

    // The dock spans the whole column, while the composer card under it is an
    // inset, centred box. Mirroring the host's own two rules — the bar's
    // `padding: 0 var(--dsh-composer-side-clearance)` around a child capped at
    // `var(--dsh-composer-card-max-width)` — puts the quotes on exactly the same
    // left edge as the composer, through resizes, the embedded variant and the
    // column-width setting alike.
    var cardRowStyle = {
      padding: '0 var(--dsh-composer-side-clearance, 16px)',
    };

    var cardWrapStyle = {
      boxSizing: 'border-box',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      width: '100%',
      maxWidth: 'var(--dsh-composer-card-max-width, 952px)',
      margin: '0 auto',
      padding: '4px 0 0',
      fontFamily: 'inherit',
    };

    var cardStyle = {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'flex-start',
      gap: '6px',
      maxWidth: '320px',
      padding: '6px 8px 6px 10px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderLeft: '3px solid var(--dsw-alias-state-business-primary)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '12px',
      lineHeight: '1.45',
    };

    var cardTextStyle = {
      display: 'block',
      overflow: 'hidden',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      // Two lines: enough to recognise the passage, short enough to stay a chip.
      maxHeight: '2.9em',
    };

    var cardMoreStyle = {
      display: 'block',
      color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
      fontSize: '11px',
    };

    var removeStyle = {
      flex: '0 0 auto',
      width: '16px',
      height: '16px',
      marginTop: '1px',
      padding: '0',
      border: 'none',
      borderRadius: '4px',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: '13px',
      lineHeight: '16px',
      textAlign: 'center',
      cursor: 'pointer',
    };

    /**
     * The cards themselves, drawn in the composer's own dock so they sit above
     * the input box rather than inside it. This component also owns the send
     * patch for its session: it mounts exactly when that composer is on screen.
     */
    function QuoteCards(props) {
      var t = props.translate;
      var root = props.root;
      var sessionId = typeof props.sessionId === 'string' ? props.sessionId : '';

      var itemsState = React.useState(function () {
        return cardsFor(sessionId);
      });
      var items = itemsState[0];
      var setItems = itemsState[1];

      React.useEffect(function () {
        function sync() {
          setItems(cardsFor(sessionId));
        }
        sync();
        return subscribe(sync);
      }, [sessionId]);

      React.useEffect(
        function () {
          var timer = 0;
          var tries = 0;
          var release = null;
          // The dock can mount before this session has a retained binding, and the
          // shell only exists after that. Retry briefly instead of giving up.
          function hook() {
            if (release) return;
            var shell = shellFor(root, sessionId);
            release = attachSender(shell, sessionId);
            if (release) return;
            if (tries >= 20) {
              // Cards still render; only the send hook is missing. Say so once,
              // instead of failing silently the way 0.4.1 did.
              if (typeof console !== 'undefined' && console.warn) {
                console.warn('[quote-tray] could not hook this compose box, so cards will not be sent');
              }
              return;
            }
            tries += 1;
            timer = setTimeout(hook, 250);
          }
          hook();
          return function () {
            if (timer) clearTimeout(timer);
            if (release) release();
          };
        },
        [sessionId],
      );

      if (!items.length) return null;

      return React.createElement(
        'div',
        { style: cardRowStyle },
        React.createElement(
          'div',
          { style: cardWrapStyle, 'data-dsh-quote-tray-cards': '', role: 'list' },
          items.map(function (card) {
            var preview = previewOf(card.text);
            return React.createElement(
              'div',
              { key: card.id, style: cardStyle, role: 'listitem', title: card.text },
              React.createElement(
                'div',
                { style: { minWidth: '0' } },
                React.createElement('span', { style: cardTextStyle }, preview.head),
                preview.extra ? React.createElement('span', { style: cardMoreStyle }, t('card.more')) : null,
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  style: removeStyle,
                  title: t('card.remove'),
                  'aria-label': t('card.remove'),
                  onClick: function () {
                    removeCard(sessionId, card.id);
                  },
                },
                '×',
              ),
            );
          }),
        ),
      );
    }

    module.exports = {
      name: NS,
      // Only the two halves the pill cannot work without. `conversation` and
      // `sessions` are looked up lazily and guarded: requiring them here would
      // take the whole plugin down on a host that has no input hub, while the
      // cards would still have rendered.
      inject: ['slots', 'locale'],
      /** Exposed for the offline tests in `test/`; not used by the runtime. */
      __test: {
        normalize: normalize,
        asQuote: asQuote,
        quoteBlock: quoteBlock,
        composeOutgoing: composeOutgoing,
        previewOf: previewOf,
        place: place,
        offScreen: offScreen,
        probe: probe,
        sessionOf: sessionOf,
        cardsFor: cardsFor,
        addCard: addCard,
        removeCard: removeCard,
        takeCards: takeCards,
        restoreCards: restoreCards,
        subscribe: subscribe,
        attachSender: attachSender,
        shellFor: shellFor,
      },
      apply: function (ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, 'zh', zh);
        }, 'dsh-quote-tray: zh dictionary');
        ctx.effect(function () {
          return ctx.locale.register(NS, 'en', en);
        }, 'dsh-quote-tray: en dictionary');

        var t = ctx.locale.bind(NS);

        ctx.slots.inject(DOCK_SLOT, function () {
          return ctx.slots.register(
            {
              name: DOCK_SLOT,
              id: DOCK_ID,
              order: 40,
              locale: NS,
              label: function () {
                return t('card.label');
              },
            },
            function (props) {
              return React.createElement(QuoteCards, Object.assign({}, props, { translate: t, root: ctx }));
            },
          );
        });

        ctx.slots.inject(OVERLAY_SLOT, function () {
          return ctx.slots.register(
            {
              name: OVERLAY_SLOT,
              id: OVERLAY_ID,
              order: 30,
              locale: NS,
              label: function () {
                return t('action.ask');
              },
            },
            function (props) {
              return React.createElement(SelectionFollowup, Object.assign({}, props, { translate: t }));
            },
          );
        });
      },
    };

    return module.exports;
  },
});
