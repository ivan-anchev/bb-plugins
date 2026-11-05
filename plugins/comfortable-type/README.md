# bb-plugin-comfortable-type

Contributes one theme, **Comfortable Type**
(`plugin:comfortable-type:comfortable`), that raises bb's desktop type scale to
T3 Code's 14px body text in the system font, without touching colors.

- `themes/comfortable.css`: the theme. CSS variables only; each one is
  commented with the bb value it replaces.
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
