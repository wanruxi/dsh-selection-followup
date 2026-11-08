# dsh-selection-followup

Select text anywhere in a DeepSeek Harness conversation and a small **追问** pill
appears above the selection. Click it and the selected text is quoted into the
composer as a Markdown block quote, ready for a follow-up question.

在 DeepSeek Harness 对话里选中一段文字，选区上方会浮出一个小「追问」按钮。
点一下，选中的内容就变成 Markdown 引用块落进输入框，接着问就行。

<p align="center">
  <img src="assets/icon-180.png" width="120" alt="dsh-selection-followup icon">
</p>

## Behaviour / 行为

- Appears only for a non-empty selection outside editable fields and outside the
  pill itself, so typing in the composer never triggers it.
  / 只在非空选区内出现；输入框内部和按钮自己的选区都跳过，打字不会误触发。
- The quoted text is inserted at the caret as one undoable plain-text edit
  (`InputActions.captureInsertion()` + `insertText()`). If the composer is
  mid-submit and refuses the edit, the draft is appended instead.
  / 引用文本以一次可撤销的纯文本编辑插到光标处（`captureInsertion()` +
  `insertText()`）；输入框正在提交、拒绝编辑时改为追加到草稿。
- Each selected line is prefixed with `> ` and followed by a blank line.
  / 选中的每一行前面加 `> `，末尾补一个空行。
- Selections longer than 8,000 characters are truncated with an ellipsis so a
  stray `Ctrl+A` cannot dump a whole page into the prompt.
  / 超过 8000 字符会被截断并加省略号，防止 `Ctrl+A` 把整页塞进提示词。
- Keyboard focus never moves to the pill (`mousedown` is prevented), so the
  selection stays intact until the click completes.
  / 点击前不让焦点跑掉（`mousedown` 被 preventDefault），选区不会提前消失。

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
| `cordis.patch.yml` | Bundle patch that inserts the plugin row |
| `icon.svg` | Plugin icon |
| `assets/icon-180.png` | Storefront tile |

## Licence / 许可

MIT.
