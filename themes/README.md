# Themes

bb custom themes: plain CSS, not plugins. bb reads each one from
`<bb theme dir>/<id>/theme.css`, and the folder name is the theme id.

| Theme | Look |
| --- | --- |
| [`zeron`](zeron/theme.css) | bb dressed as the Zeron desktop app: Geist type, a near-black frame with two rounded cards, a near-white primary and a violet accent. Dark and light. |

## Install

Download the theme into bb's theme directory and turn it on:

```sh
d="$(bb theme dir)/zeron"
mkdir -p "$d"
curl -fsSL https://raw.githubusercontent.com/ivan-anchev/bb-plugins/main/themes/zeron/theme.css -o "$d/theme.css"
bb theme set zeron
```

Run the same commands again to update it. `bb theme reset` goes back to bb's
default.
