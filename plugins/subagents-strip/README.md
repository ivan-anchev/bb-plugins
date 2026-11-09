# bb-plugin-subagents-strip

A live strip above a thread's composer that counts the latest prompt's subagents
and child threads, plus any still running, and how long they have taken, and
opens into one row per subagent that expands to its report and latest steps and
opens its full transcript in the side panel or its own thread; a Subagents tab in
the side panel lists every subagent in the thread, grouped by the prompt it was
launched after.

## Develop

```sh
bb plugin install ./plugins/subagents-strip   # once
bb plugin dev plugins/subagents-strip         # rebuild and reload on save
npm test --workspace plugins/subagents-strip
```

To see it live, ask a Claude Code thread to launch two subagents with
`run_in_background: true`.
