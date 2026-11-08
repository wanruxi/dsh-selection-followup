// Client half of dsh-selection-followup.
//
// Select any text in the web GUI and a small "追问" pill appears next to the
// pointer; clicking it (or pressing Ctrl+Shift+Q) turns the selection into a
// reference chip inside the composer — the same node type the @ file mention
// uses — so the quote reads as a card instead of a wall of ">". The chip's
// clipboard text is the Markdown block quote and the registered quote source
// serializes it on submit, so the model still receives the quoted lines
// verbatim. When the host exposes no way to insert a chip, the plugin falls
// back to the plain block quote it used before.
window.__ModuleLoader__.load({
  id: 'dsh-selection-followup',
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var ReactDOM = require('react-dom');

    var NS = 'dsh-selection-followup';
    var OVERLAY_SLOT = 'conversation.input.overlay';
    var OVERLAY_ID = 'selection-followup';
    /** Reference source name; the trigger "@" plus this must stay unique. */
    var SOURCE = 'selection-followup';

    /** First-frame estimate; the rendered pill reports its real box right after. */
    var PILL_HEIGHT = 30;
    var PILL_WIDTH = 96;
    /** Upper bound so selecting a whole page cannot paste megabytes of text. */
    var MAX_CHARS = 8000;
    /** How long the confirmation pill stays up after a successful insertion. */
    var FLASH_MS = 900;

    var SESSION_ATTR = 'data-conversation-session';

    var zh = {
      'action.ask': '追问',
      'action.askTip': '把选中的内容引用到输入框，再接着提问（Ctrl+Shift+Q）',
      'action.askTipLong': '选中内容过长，只会引用前 8000 个字符（Ctrl+Shift+Q）',
      'action.done': '已引用',
      chip: '引用',
    };
    var en = {
      'action.ask': 'Ask',
      'action.askTip': 'Quote the selection into the composer, then ask (Ctrl+Shift+Q)',
      'action.askTipLong': 'Selection is long; only the first 8000 characters are quoted (Ctrl+Shift+Q)',
      'action.done': 'Quoted',
      chip: 'Quote',
    };

    /**
     * The chat surface registers a source per reference kind; the codec is what
     * a submit uses to turn the chip back into text. Registering the source
     * without a codec would make every send that carries one fail outright, so
     * both halves live here together.
     */
    var SOURCE_SPEC = {
      trigger: '@',
      name: SOURCE,
      order: 70,
      showGroupTitle: false,
      candidates: function () {
        return Promise.resolve([]);
      },
      codec: {
        clipboardText: function (ref) {
          return asQuote(normalize(String(ref == null ? '' : ref)));
        },
        serialize: function (ref) {
          return Promise.resolve(asQuote(normalize(String(ref == null ? '' : ref))));
        },
      },
    };

    /**
     * Only the first mounted composer owns the page-level listeners: the pill is
     * a single floating object, and duplicating the listener set would just fight
     * over where to draw it. `mine()` keeps it from quoting across sessions.
     */
    var owner = null;
    /** Disposer of the registered quote source, once the host accepts it. */
    var serializerRelease = null;

    function elementOf(node) {
      if (!node) return null;
      return node.nodeType === 1 ? node : node.parentElement;
    }

    function isOurs(node) {
      var el = elementOf(node);
      return !!(el && el.closest && el.closest('[data-dsh-selection-followup]'));
    }

    function isEditable(node) {
      var el = elementOf(node);
      if (!el || typeof el.closest !== 'function') return false;
      return !!el.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [data-dsh-selection-followup]',
      );
    }

    /**
     * The session a selection belongs to, when the shell marks its DOM. Several
     * sessions can be on screen at once (side conversations), and a quote must
     * land in the composer it was selected in, not the first one that mounted.
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

    /** A composer service, when the host still exposes it. */
    function service(root, name) {
      try {
        return root && typeof root.get === 'function' ? root.get(name) : undefined;
      } catch (error) {
        return undefined;
      }
    }

    /**
     * The slash controller of one session: the only supported door to
     * `INSERT REFERENCE`, and the object that knows whether a span is still
     * current. Returns null whenever the host is not willing to hand it over.
     */
    function controllerFor(root, sessionId) {
      if (!sessionId) return null;
      try {
        var sessions = service(root, 'sessions');
        var triggers = service(root, 'inputTriggers');
        if (!sessions || !triggers || typeof sessions.binding !== 'function') return null;
        var binding = sessions.binding(sessionId);
        if (!binding || !binding.ctx || typeof triggers.sessionOf !== 'function') return null;
        return triggers.sessionOf(binding.ctx) || null;
      } catch (error) {
        return null;
      }
    }

    /**
     * Registering the source is what makes a chip survive a submit: without the
     * codec the send is rejected with `no serializer for reference source`.
     * Registration can only happen once the service is up, so every attempt
     * after the first activation retries it.
     */
    function registerSerializer(root) {
      if (serializerRelease) return true;
      var triggers = service(root, 'inputTriggers');
      if (!triggers || typeof triggers.registerSource !== 'function') return false;
      try {
        var off = triggers.registerSource(SOURCE_SPEC);
        serializerRelease = typeof off === 'function' ? off : function () {};
        return true;
      } catch (error) {
        // Another plugin already claimed this source name, or the roster closed.
        console.warn('[selection-followup] quote source unavailable:', error);
        return false;
      }
    }

    function releaseSerializer() {
      if (!serializerRelease) return;
      try {
        serializerRelease();
      } catch (error) {
        /* the roster is going away anyway */
      }
      serializerRelease = null;
    }

    /**
     * One insertion attempt. The composer refuses a stale span, so a second
     * capture is worth trying before giving up on the chip route.
     */
    function withSpan(actions, run) {
      for (var attempt = 0; attempt < 2; attempt += 1) {
        try {
          var span = actions.captureInsertion();
          if (span && run(span) === true) return true;
        } catch (error) {
          return false;
        }
      }
      return false;
    }

    /**
     * Markdown keeps a ">" line inside the paragraph above it when the quote is
     * glued to the end of existing text, so the insertion point is nudged onto a
     * fresh paragraph first. A chip in the draft hides the surrounding text, so
     * only the visible draft prefix is inspected.
     */
    function leadingBreak(actions, draft) {
      var start = 0;
      try {
        var span = actions.captureInsertion();
        if (span && typeof span.start === 'number') start = span.start;
      } catch (error) {
        start = 0;
      }
      if (start <= 0) return '';
      var head = String(draft == null ? '' : draft).slice(0, start);
      if (/\n\n$/.test(head)) return '';
      if (/\n$/.test(head)) return '\n';
      return '\n\n';
    }

    function nudge(actions, text) {
      if (!text) return true;
      return withSpan(actions, function (span) {
        return actions.insertText(text, span) === true;
      });
    }

    /** Plain block quote into the draft; the last resort when chips are refused. */
    function insertQuote(actions, draft, body) {
      var payload = asQuote(body);
      for (var attempt = 0; attempt < 2; attempt += 1) {
        try {
          var span = actions.captureInsertion();
          if (span && actions.insertText(payload, span) === true) return true;
        } catch (error) {
          break;
        }
      }
      try {
        var head = String(draft == null ? '' : draft).replace(/\s*$/, '');
        actions.setDraft(head ? head + '\n\n' + payload : payload);
        return true;
      } catch (error) {
        return false;
      }
    }

    /**
     * Quote `text` into the composer. Returns 'chip' when the reference card was
     * inserted, 'text' when only the block quote survived, and 'failed' /
     * 'empty' / 'unavailable' otherwise, so the caller can say what happened.
     */
    function quoteInto(actions, controller, draft, text, label) {
      var body = normalize(text);
      if (!body) return 'empty';
      if (!actions || typeof actions.captureInsertion !== 'function') return 'unavailable';
      if (controller && typeof controller.execute === 'function') {
        nudge(actions, leadingBreak(actions, draft));
        var reference = {
          source: SOURCE,
          ref: body,
          label: label || 'Quote',
          appearance: 'session',
          clipboardText: asQuote(body),
        };
        var chipped = withSpan(actions, function (span) {
          return controller.execute({ insert: reference }, span) === true;
        });
        if (chipped) return 'chip';
      }
      return insertQuote(actions, draft, body) ? 'text' : 'failed';
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
      var inputActions = props.inputActions;
      var controllerOf = props.controllerOf;
      var mySession = typeof props.sessionId === 'string' ? props.sessionId : undefined;
      var draft = props.useInput(function (state) {
        return typeof state.draft === 'string' ? state.draft : '';
      });

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

      var draftRef = React.useRef('');
      draftRef.current = draft;
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
          busyRef.current = true;
          var result = 'failed';
          try {
            result = quoteInto(inputActions, controllerOf(session), draftRef.current, text, t('chip'));
          } finally {
            busyRef.current = false;
          }
          if (result !== 'chip' && result !== 'text') return false;
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
        [inputActions, controllerOf, t],
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
              'data-dsh-selection-followup': '',
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
            'data-dsh-selection-followup': '',
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

    module.exports = {
      name: NS,
      inject: ['slots', 'locale'],
      /** Exposed for the offline tests in `test/`; not used by the runtime. */
      __test: {
        normalize: normalize,
        asQuote: asQuote,
        place: place,
        offScreen: offScreen,
        probe: probe,
        sessionOf: sessionOf,
        leadingBreak: leadingBreak,
        quoteInto: quoteInto,
        sourceSpec: SOURCE_SPEC,
      },
      apply: function (ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, 'zh', zh);
        }, 'dsh-selection-followup: zh dictionary');
        ctx.effect(function () {
          return ctx.locale.register(NS, 'en', en);
        }, 'dsh-selection-followup: en dictionary');

        // The codec must exist before any chip is sent; a late registration
        // sticks, so a composer that mounted early still works.
        ctx.effect(function () {
          registerSerializer(ctx);
          return function () {
            releaseSerializer();
          };
        }, 'dsh-selection-followup: quote serializer');

        var t = ctx.locale.bind(NS);

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
              return React.createElement(
                SelectionFollowup,
                Object.assign({}, props, {
                  translate: t,
                  controllerOf: function (sessionId) {
                    if (!registerSerializer(ctx)) return null;
                    return controllerFor(ctx, sessionId);
                  },
                }),
              );
            },
          );
        });
      },
    };

    return module.exports;
  },
});
