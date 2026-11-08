# dsh-selection-followup

Select text anywhere in a DeepSeek Harness conversation and a small **追问** pill
appears next to the selection. Click it and the selected text is quoted into the
composer as a Markdown block quote, ready for a follow-up question.

在 DeepSeek Harness 对话里选中一段文字，选区旁边会浮出一个小「追问」按钮。
点一下，选中的内容就变成 Markdown 引用块落进输入框，接着问就行。

<p align="center">
  <img src="assets/icon-180.png" width="120" alt="dsh-selection-followup icon">
</p>

## Behaviour / 行为

- Appears only for a non-empty selection outside editable fields and outside the
  pill itself, so typing in the composer never triggers it.
  / 只在非空选区内出现；输入框内部和按钮自己的选区都跳过，打字不会误触发。
- The pill follows the pointer: it opens just below-right of where the mouse
  button came up, and above the selection for a keyboard selection. Near a
  viewport edge it flips to the other side, and its real rendered size is used
  for the clamp, so a long label in any language stays fully visible.
  / 按钮跟着指针走：鼠标松开处右下方弹出，键盘选区则落在选区上方；靠近窗口边缘会翻到
  另一侧，贴边收拢用的是按钮实测尺寸，任何语言的长标签都不会被切掉。
- After a successful quote the pill turns into a brief **已引用 / Quoted** receipt.
  It does not take pointer events, so it never blocks the next click.
  / 引用成功后按钮原地变成一句「已引用」回执，短暂停留；它不接收鼠标事件，不会挡住你
  下一次点击。
- A selection scrolled out of view offers nothing — the pill is not pinned to the
  screen edge for text the reader can no longer see.
  / 选区滚出可视范围就不再出现按钮，不会把按钮钉在屏幕边缘去引用一段你已经看不见的字。
- `Ctrl+Shift+Q` quotes the current selection without touching the mouse. Ctrl
  only, on every platform — `Cmd+Shift+Q` is macOS "log out".
  / `Ctrl+Shift+Q` 不用鼠标也能引用当前选区。所有平台都只认 Ctrl——`Cmd+Shift+Q` 在
  macOS 上是「注销」。
- `Esc` dismisses it.
  / `Esc` 收起。
- The quoted text is inserted at the caret as one undoable plain-text edit
  (`InputActions.captureInsertion()` + `insertText()`), retrying once with a
  fresh span if the draft moved in between. If the composer is mid-submit and
  refuses the edit, the draft is appended instead.
  / 引用文本以一次可撤销的纯文本编辑插到光标处（`captureInsertion()` +
  `insertText()`）；草稿版本在中间变过会重取一次再插。输入框正在提交、拒绝编辑时改为
  追加到草稿。
- Selected text is normalised before quoting: CRLF collapsed, trailing spaces
  and runs of blank lines removed.
  / 引用前先规整选区：统一换行、去掉行尾空格、合并多余空行。
- Each selected line is prefixed with `> ` and followed by a blank line, so a
  follow-up typed behind the quote can never be swallowed by Markdown's lazy
  continuation.
  / 选中的每一行前面加 `> `，末尾补一个空行——这样紧跟着写的问题不会被 Markdown 的
  懒续行吞进引用块。
- A selection made in another session (side conversation) never quotes into this
  one.
  / 在别的会话（侧边对话）里选的文字，不会被引到这个会话的输入框。
- Selections longer than 8,000 characters are truncated with an ellipsis, and
  the tooltip says so rather than truncating silently.
  / 超过 8000 字符会被截断并加省略号，悬停提示会说明，而不是悄悄截断。
- Keyboard focus never moves to the pill (`mousedown` is prevented), so the
  selection stays intact until the click completes.
  / 点击前不让焦点跑掉（`mousedown` 被 preventDefault），选区不会提前消失。

## How it differs from the neighbours / 与相近插件的区别

Several Harness plugins quote a selection into the composer. This one takes the
plain-text route on purpose:

| | This plugin | Chip-style plugins |
| --- | --- | --- |
| What lands in the draft | Ordinary Markdown `> …` text | A non-textual chip node |
| Editable afterwards | Yes, like any typed text | Through the chip's own UI |
| Needs a serializer registered on the host | No | Yes — a missing codec fails the send |
| Survives a draft rewrite | Yes | Depends on the chip's draft encoding |

几个同类插件都会把选区引用进输入框。这个插件刻意走纯文本路线：落在草稿里的是普通
Markdown 文本，之后能像自己打的字一样随便改，不需要在宿主上注册序列化器，也不会因为
草稿被整体重写而丢失。代价是没有迷你引用条、悬停预览和「引用这条回复」这类富交互。

## Tests / 测试

Pure helpers are covered offline, no browser needed:

```
npm test      # node --test test/helpers.test.mjs
npm run check # syntax check both halves
```

纯函数有离线测试，不用开浏览器。覆盖引用格式、空白规整、按钮贴边收拢、会话隔离和插入
失败时的回退。界面本身仍需人工看一遍。

## Install / 安装

From the Harness profile that should run it:

```
dsh plugin --profile <profile> add dsh-selection-followup
```

or, inside the Harness GUI, drop this repository's directory into the plugin
manager as a bundle. The browser half loads immediately; a page refresh is
enough, no restart.

/ 也可以把本仓库目录作为 bundle 装进插件管理器。浏览器半边立即生效，刷新页面即可，
不用重启。

## Compatibility / 兼容性

`dsh.client.platform` is `web`, and the browser half uses the
`conversation.input.overlay` slot plus `InputActions`. Any Harness build that
publishes those works; the declared `engines.dsh` range is the tested floor.

## Layout / 文件分工

| File | Role |
| --- | --- |
| `lib/index.js` | Host half — empty, exists so the bundle has a loadable entry |
| `lib/client.js` | Browser half — selection listeners, floating pill, composer insertion |
| `test/helpers.test.mjs` | Offline tests for the pure helpers |
| `cordis.patch.yml` | Bundle patch that inserts the plugin row |
| `icon.svg` | Plugin icon |
| `assets/icon-180.png` | Storefront tile |

## Licence / 许可

MIT.
