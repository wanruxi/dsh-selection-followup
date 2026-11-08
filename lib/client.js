// Client half of dsh-selection-followup.
//
// Select any text in the web GUI and a small "追问" pill appears next to the
// pointer; clicking it (or pressing Ctrl+Shift+Q) quotes the selection into the
// composer at the caret — one undoable edit when the editor allows it, otherwise
// a draft rewrite as the fallback.
window.__ModuleLoader__.load({
  id: 'dsh-selection-followup',
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var ReactDOM = require('react-dom');

    var NS = 'dsh-selection-followup';
    var PILL_HEIGHT = 30;
    /** Rough pill width, used only to keep the pill inside the viewport. */
    var PILL_WIDTH = 96;
    /** Upper bound so selecting a whole page cannot paste megabytes of text. */
    var MAX_CHARS = 8000;

    var zh = {
      'action.ask': '追问',
      'action.askTip': '把选中的内容引用到输入框，再接着提问（Ctrl+Shift+Q）',
      'action.askTipLong': '选中内容过长，只会引用前 8000 个字符（Ctrl+Shift+Q）',
    };
    var en = {
      'action.ask': 'Ask',
      'action.askTip': 'Quote the selection into the composer, then ask (Ctrl+Shift+Q)',
      'action.askTipLong': 'Selection is long; only the first 8000 characters are quoted (Ctrl+Shift+Q)',
    };

    var SESSION_ATTR = 'data-conversation-session';

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
      var body = text
        .split('\n')
        .map(function (line) {
          return line.length > 0 ? '> ' + line : '>';
        })
        .join('\n');
      return body + '\n\n';
    }

    /** Nearest to the pointer when the selection came from the mouse. */
    function place(anchor, rect) {
      var x;
      var y;
      if (anchor && typeof anchor.x === 'number') {
        x = anchor.x + 14;
        y = anchor.y + 16;
        if (y + PILL_HEIGHT > window.innerHeight - 8) y = anchor.y - 16 - PILL_HEIGHT;
        if (x + PILL_WIDTH > window.innerWidth - 8) x = anchor.x - 14 - PILL_WIDTH;
      } else {
        x = rect.left + rect.width / 2 - PILL_WIDTH / 2;
        y = rect.top - PILL_HEIGHT - 8;
        if (y < 8) y = rect.bottom + 8;
      }
      var maxX = window.innerWidth - PILL_WIDTH - 8;
      var maxY = window.innerHeight - PILL_HEIGHT - 8;
      if (x > maxX) x = maxX;
      if (x < 8) x = 8;
      if (y > maxY) y = maxY;
      if (y < 8) y = 8;
      return { top: y, left: x };
    }

    function probe(anchor) {
      var selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
      var raw = selection.toString();
      if (!raw || raw.replace(/\s+/g, '') === '') return null;
      var range = selection.getRangeAt(0);
      if (isOurs(range.startContainer) || isOurs(range.endContainer)) return null;
      if (isEditable(range.startContainer) || isEditable(range.endContainer)) return null;
      var rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;

      var text = normalize(raw);
      if (!text) return null;
      var truncated = text.length > MAX_CHARS;
      if (truncated) text = text.slice(0, MAX_CHARS) + '…';
      return {
        text: text,
        truncated: truncated,
        session: sessionOf(range.startContainer),
        at: place(anchor, rect),
      };
    }

    /**
     * One insertion attempt. The composer refuses a stale span, so a second
     * capture is worth trying before falling back to a full draft rewrite.
     */
    function insert(actions, draft, payload) {
      for (var attempt = 0; attempt < 2; attempt += 1) {
        try {
          var span = actions.captureInsertion();
          if (span && actions.insertText(payload, span) === true) return true;
        } catch (error) {
          break;
        }
      }
      try {
        var head = String(draft || '').replace(/\s*$/, '');
        actions.setDraft(head ? head + '\n\n' + payload : payload);
        return true;
      } catch (error) {
        return false;
      }
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
    };

    function SelectionFollowup(props) {
      var t = props.translate;
      var inputActions = props.inputActions;
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

      var draftRef = React.useRef('');
      draftRef.current = draft;
      var spotRef = React.useRef(null);
      spotRef.current = spot;
      /** The pointer position of the last mouse selection, or null. */
      var anchorRef = React.useRef(null);
      var sessionRef = React.useRef(undefined);
      sessionRef.current = mySession;

      var commit = React.useCallback(
        function (forcedText) {
          var text = typeof forcedText === 'string' ? forcedText : spotRef.current ? spotRef.current.text : '';
          if (!text) return false;
          var ok = insert(inputActions, draftRef.current, asQuote(text));
          if (!ok) return false;
          var selection = window.getSelection();
          if (selection) selection.removeAllRanges();
          anchorRef.current = null;
          setSpot(null);
          return true;
        },
        [inputActions],
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
          var next = mine(probe(anchorRef.current));
          setSpot(function (prev) {
            if (!next) return null;
            if (prev && prev.text === next.text && prev.at.top === next.at.top && prev.at.left === next.at.left) {
              return prev;
            }
            return next;
          });
        }
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
          var found = mine(probe(null));
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

        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('selectionchange', schedule);
        document.addEventListener('mouseup', schedule);
        document.addEventListener('keyup', onKeyTyping);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        return function () {
          if (frame) cancelAnimationFrame(frame);
          document.removeEventListener('pointerup', onPointerUp, true);
          document.removeEventListener('selectionchange', schedule);
          document.removeEventListener('mouseup', schedule);
          document.removeEventListener('keyup', onKeyTyping);
          document.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('scroll', schedule, true);
          window.removeEventListener('resize', schedule);
          if (owner === tokenRef.current) owner = null;
          anchorRef.current = null;
          setSpot(null);
        };
      }, []);

      if (!active || !spot) return null;

      return ReactDOM.createPortal(
        React.createElement(
          'button',
          {
            type: 'button',
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
        probe: probe,
        sessionOf: sessionOf,
        insert: insert,
      },
      apply: function (ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, 'zh', zh);
        }, 'dsh-selection-followup: zh dictionary');
        ctx.effect(function () {
          return ctx.locale.register(NS, 'en', en);
        }, 'dsh-selection-followup: en dictionary');

        var t = ctx.locale.bind(NS);

        ctx.slots.inject('conversation.input.overlay', function () {
          return ctx.slots.register(
            {
              name: 'conversation.input.overlay',
              id: 'selection-followup',
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
