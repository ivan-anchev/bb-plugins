# bb-plugin-generative-ui

Draws ` ```openui ` fenced blocks in assistant messages as live UI, using
[OpenUI](https://github.com/thesysdev/openui)'s stock component library
(`@openuidev/react-ui/genui-lib`, `openuiLibrary`) rendered by
`@openuidev/react-lang`, unmodified.

- `app.tsx`: claims the `openui` and `openui-lang` fences with
  `experimental_codeFenceRenderer`.
- `src/app/ui-block.tsx`: one fence. Streams into OpenUI's `Renderer`; a closed
  block with no drawable `root` falls back to bb's code block.
- `src/app/bb-theme-scope.tsx`: OpenUI's `ThemeProvider` in bb's light or dark
  mode, with its CSS variables scoped to the block instead of `<body>`.
- `src/app/use-block-actions.ts`: `@ToAssistant` sends a user message to the
  thread; `@OpenUrl` opens the link through bb.
- `src/action-message.ts`: the text of that user message (pure, tested).
- `src/library.ts`: the one library both the renderer and the skill use.
- `server.ts`, `src/agent/instructions.ts`: a short standing rule for
  person-facing threads, under bb's 4096-character limit.
- `skills/generative-ui/SKILL.md`: hand-written guidance plus OpenUI's
  generated component reference. `npm run skill` rewrites the generated
  section; `src/agent/skill-spec.test.ts` fails when it drifts from the
  installed OpenUI.

## Develop

```sh
bb plugin install ./plugins/generative-ui   # once
bb plugin dev plugins/generative-ui         # rebuild and reload on save
npm test --workspace plugins/generative-ui
npm run skill --workspace plugins/generative-ui   # after bumping OpenUI
```

Instructions and skills take effect when a thread's provider session next
starts, so test them in a new thread.

## Notes

- `tsconfig.json` sets `skipLibCheck`: the `@openuidev/react-ui` root types
  import `eve/client`, a dev-only dependency of `@openuidev/react-headless`
  that npm never installs. `ThemeProvider` is only exported from that root.
- `@openuidev/react-lang` marks `react-native` and `@modelcontextprotocol/sdk`
  as optional peers, so a standalone `npm install --omit=dev` installs
  neither. React and ReactDOM are shimmed to bb's copies at build time.
