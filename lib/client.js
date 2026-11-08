// Client half of dsh-selection-followup.
//
// Select any text in the web GUI, a small "追问" pill appears above the
// selection, and clicking it quotes the selection into the composer at the
// caret — one undoable edit when the editor allows it, otherwise a draft
// rewrite as the fallback.
window.__ModuleLoader__.load({
  id: 'dsh-selection-followup',
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var ReactDOM = require('react-dom');

    var NS = 'dsh-selection-followup';
    var PILL_HEIGHT = 30;
    /** Upper bound so selecting a whole page cannot paste megabytes of text. */
    var MAX_CHARS = 8000;

    var zh = {
      'action.ask': '追问',
      'action.askTip': '把选中的内容引用到输入框，再接着提问',
    };
    var en = {
      'action.ask': 'Ask',
      'action.askTip': 'Quote the selection into the composer, then ask',
    };

    /** Only the first mounted composer owns the page-level selection listeners. */
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

    function asQuote(text) {
      var body = text.split(/\r?\n/).map(function (line) {
        return line.length > 0 ? '> ' + line : '>';
      }).join('\n');
      return body + '\n\n';
    }

    function place(rect) {
      var top = rect.top - PILL_HEIGHT - 8;
      if (top < 8) top = rect.bottom + 8;
      var left = rect.left + rect.width / 2 - 34;
      var max = window.innerWidth - 76;
      if (left > max) left = max;
      if (left < 8) left = 8;
      return { top: top, left: left };
    }

    function probe() {
      var selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
      var text = selection.toString().replace(/^\s+|\s+$/g, '');
      if (!text) return null;
      var range = selection.getRangeAt(0);
      if (isOurs(range.startContainer) || isOurs(range.endContainer)) return null;
      if (isEditable(range.startContainer) || isEditable(range.endContainer)) return null;
      var rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;
      if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '…';
      return { text: text, at: place(rect) };
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

      React.useEffect(function () {
        if (owner !== null) return undefined;
        owner = tokenRef.current;
        setActive(true);

        var frame = 0;
        function settle() {
          frame = 0;
          var next = probe();
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

        document.addEventListener('selectionchange', schedule);
        document.addEventListener('mouseup', schedule);
        document.addEventListener('keyup', schedule);
        window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        return function () {
          if (frame) cancelAnimationFrame(frame);
          document.removeEventListener('selectionchange', schedule);
          document.removeEventListener('mouseup', schedule);
          document.removeEventListener('keyup', schedule);
          window.removeEventListener('scroll', schedule, true);
          window.removeEventListener('resize', schedule);
          if (owner === tokenRef.current) owner = null;
          setSpot(null);
        };
      }, []);

      var commit = React.useCallback(function () {
        if (!spot) return;
        var payload = asQuote(spot.text);
        var inserted = false;
        try {
          var span = inputActions.captureInsertion();
          inserted = span ? inputActions.insertText(payload, span) === true : false;
        } catch (error) {
          inserted = false;
        }
        if (!inserted) {
          var base = draftRef.current || '';
          var head = base.replace(/\s*$/, '');
          try {
            inputActions.setDraft(head ? head + '\n\n' + payload : payload);
          } catch (error) {
            /* the composer rejected the rewrite; nothing safe left to do */
          }
        }
        var selection = window.getSelection();
        if (selection) selection.removeAllRanges();
        setSpot(null);
      }, [spot, inputActions]);

      if (!active || !spot) return null;

      return ReactDOM.createPortal(
        React.createElement(
          'button',
          {
            type: 'button',
            'data-dsh-selection-followup': '',
            title: t('action.askTip'),
            'aria-label': t('action.askTip'),
            onMouseDown: function (event) {
              event.preventDefault();
            },
            onClick: commit,
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
