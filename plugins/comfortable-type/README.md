# bb-plugin-comfortable-type

Contributes one theme, **Comfortable Type**
(`plugin:comfortable-type:comfortable`), that raises bb's desktop type scale one step,
to 14px body text in the system font, without touching colors.

- `themes/comfortable.css`: the theme. CSS variables, each commented with the
  bb value it replaces, plus one workaround for a bb layout bug: the macOS
  title bar's `[&_button]:h-(--bb-title-bar-control-size)` stretches the
  close button inside each tab pill to 28px. Drop the rule once bb fixes it.
- `server.ts`: an empty entry, because bb requires one.
- `skills/comfortable-type/SKILL.md`: how an agent turns the theme on and off.

After a bb update, check the commented bb values against
`node_modules/bb-app/app/dist/assets/index-*.css`.

## Develop

```sh
bb plugin install ./plugins/comfortable-type   # once
bb plugin dev plugins/comfortable-type         # rebuild and reload on save
bb theme set plugin:comfortable-type:comfortable
```
