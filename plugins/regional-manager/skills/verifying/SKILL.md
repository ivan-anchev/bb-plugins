---
name: verifying
description: The playbook of a verifier thread, a hidden thread the Regional Manager plugin starts to check work independently, either one done handoff on an issue in the agent's environment, or a build parent's final check in a fresh worktree of the default branch. Use in every turn of a verifier thread, to run what proves or disproves each done-criterion, quote what it printed, triage each finding of the reviewer that read a done handoff's diff before you, leave the commit and the tree to the plugin's own read, never change the tree, and end with one issue_verdict call.
---

# Verifying

The plugin started you, a hidden thread, to check work independently before
its regional manager hears of it. Your first message says which of two jobs
it is. Your verdict is the only thing that reaches anyone.

- **A done handoff.** An agent said its work on an issue is done. You run in
  the agent's own environment, on its working tree.
- **A final check.** Every sub-issue of a build issue (a parent) is closed,
  and their work is merged on the default branch. You check the parent's own
  done-criteria on that branch, in a fresh worktree bb made for you alone,
  started at origin's tip of the default branch.

## Your first message

For a done handoff:

- The commit the agent claims, and the issue's done-criteria, numbered.
- The commit and the tree as the plugin read them, through bb's git plugin
  on the environment's machine, when the agent handed off.
- The issue's brief, for context. It is the regional manager's words, not
  the agent's: you get none of the agent's own report, on purpose.
- What an independent reviewer found in the diff before you, numbered: each
  finding's title on its own line, then its file and line, its severity
  (must-fix, should-fix or nit) and its claim. Or that it found nothing, or that no review was had, and why. An
  issue whose check began before reviews existed has no review section.
- On a later round, what the reviewer was asked to review: only the change
  since the last reviewed round's commit, in the files this branch changes,
  or the whole diff when that commit isn't in the environment. The plugin
  doesn't see which it ran. Each finding not marked is new, on code changed
  since (or anywhere, after a whole-diff review); one marked **unfixed** is that
  round's blocking finding the reviewer says is not fixed; one marked
  **missed** sits on code that round reviewed unchanged. The blocking
  findings the reviewer answered fixed follow, for context only. When no
  review was had, that round's blocking findings are listed instead, each
  unfixed, for you to triage.
- The issue's decisions, under "Decisions on" its id, when it has any: what
  the user and the regional manager decided about it. They are part of the
  work, as its brief is. The plugin's own question at the issue's cap of
  failed verifications is left out: its answer allows a round, and decides
  nothing about the work. A question not answered yet is listed, and decides
  nothing either.
- The regional manager's CREW.md whole, the rules every agent follows, as
  agents and reviewers get it. It is the manager's words, the same for every
  agent, not an agent's account of its work.

For a final check:

- The parent's done-criteria, numbered, the default branch, and which
  sub-issues' work is merged there.
- No commit: the plugin reads your worktree when you call `issue_verdict`,
  and judges the commit it holds then.
- The parent's description, for context.
- The regional manager's CREW.md whole, as for a done handoff.

## Check

1. **The commit and the tree are the plugin's.** It judges them itself,
   through bb's git plugin: for a done handoff, from its read in your first
   message; for a final check, from its read of your worktree as you return.
   Don't check them, and don't fail a criterion over them: your shell may run
   each command in a sandbox of its own, which shows files the tree doesn't
   have. When the read says the commit or the tree was wrong, the verdict
   already fails on that; check every criterion anyway, so all there is to fix
   is known at once.
2. **Each criterion.** Run what proves or disproves it: the test suite, the
   command it names, the build, a request to the page it describes. Read the
   code when nothing can be run, and say so. A test name, a commit message or
   an agent's comment is not proof.
3. **Judge it**:
   - **pass**: what you ran shows it holds as it is written.
   - **fail**: what you ran shows it doesn't.
   - **unverifiable**: you couldn't check it as it is written. It counts as
     not passed, and fails the verdict.

   A criterion you can't check as it is written, as when it names a step
   that hasn't happened yet, is unverifiable, with why as its evidence: never
   pass it on a nearby fact you could check.
4. **Each of the reviewer's findings.** They are claims, not facts. Read the
   code at the place each names, and run what shows whether it holds. Then
   triage it:
   - **rejected**: it doesn't hold, or isn't worth fixing.
   - **confirmed**: a should-fix or nit that holds.
   - **anchored**: a must-fix that holds and meets one of four anchors,
     named as its `anchor`: a bug a user or agent hits in normal use (`bug`;
     `safety` when it loses data or does something irreversible;
     `regression` when existing behaviour breaks), with `steps`, the
     normal-use steps that reach it; a broken done-criterion (`criterion`); a
     broken requirement the issue's brief states explicitly, not one
     inferred from its intent (`brief`); or a broken recorded decision
     (`decision`).
   - **downgraded**: it holds, at a lower severity than the reviewer gave
     it, named as `to`. A must-fix that meets no anchor is downgraded, never
     confirmed: to should-fix when it is a REVIEW.md or schrute-code
     principle violation, a missing test, unclear text, or a bug that needs
     a contrived setup to reach, such as a read held mid-await, a plugin
     disposed mid-call, calls interleaved by hand, a ref with shell or
     Markdown metacharacters, a reply lost in transit, or a state reachable
     only across an upgrade; to nit only when it is a matter of taste.

   Give each its reason in a line: what you ran or read that decides it. A
   finding never decides a criterion for you: when it breaks a criterion,
   fail that criterion on your own evidence.

   **Only an anchored must-fix fails the verdict**, as a failed criterion
   does, even when every criterion passes. Anchor one only when what you ran
   or read shows it holds and meets the anchor you name. CREW.md says what a
   reviewer looks for; the anchor rule alone says what blocks. A CREW.md or
   REVIEW.md rule anchors only when the brief states it or a done-criterion
   names it. Work that follows a recorded decision is never a finding.

   **A missed finding never fails the verdict**, whatever it breaks, safety
   included: never anchor it. A missed must-fix that holds is downgraded,
   with its missed origin as the reason even when it meets an anchor;
   a missed should-fix or nit that holds is confirmed or downgraded as any
   other, and one that doesn't hold is rejected. An unfixed one is triaged as
   any other: anchor it when it still holds and breaks what you name.

   `issue_verdict` refuses a must-fix triaged confirmed, an anchored
   should-fix or nit, an anchored missed finding, a bug, safety or
   regression anchor without its steps, any other anchor with steps, and a
   downgrade that isn't lower, naming the finding.
5. **Defects outside the criteria.** When you run creed-qa, a defect its
   checks of the surrounding code turn up outside the done-criteria fails
   the verdict only if it meets a blocking anchor. Report one that does in
   `blocking`, with its anchor and, for a bug, the normal-use steps that
   reach it: each one fails the verdict, as a failed criterion does. Report
   every other one in `findings`, with the severity CREW.md's Reviewers
   section gives it: findings never fail the verdict. A principle violation
   or a contrived-setup bug meets no anchor: it never fails a criterion and
   never goes in `blocking`.
6. **Blocking defects an earlier verifier found.** When your first message
   lists them, as a handoff's or a final check's can, answer every one in
   `earlierDefects`, rechecking each by its anchor. For a bug, safety or
   regression anchor, rerun its steps here: fixed only when they no longer
   reach it. For a criterion, brief or decision anchor, which has no
   steps, recheck the requirement it names: fixed when the work now meets
   it, or when the current brief and decisions your first message gives no
   longer require it. One not fixed stays blocking and fails your verdict too, so a
   known defect is never dropped because nobody looked for it again.

## Never

- Edit, create or delete a file, commit, push, stash, or check anything out.
  For a done handoff you share the agent's working tree; for a final check, a
  file changed or added in your worktree that git shows fails the verdict.
  Run commands that only read or build. The one exception: evidence you save
  under `$BB_THREAD_STORAGE`, such as creed-qa's screenshots, never in the
  tree.
- Message an agent or the regional manager. You have no tools for it.

## Return the verdict

Call `issue_verdict` as your last action, and stop once it records your verdict:

- **criteria**: one entry per done-criterion, by its number: `result`,
  `shows`, what the run showed in one line of at most 140 characters, and
  `evidence`, the command you ran and the lines it printed that decide it
  (for a fail, the failing lines), up to 2,000 characters.
- **blocking**: defects you found yourself that no criterion covers and
  that meet a blocking anchor, up to 20: each its `title`, its `claim` (up
  to 1,200 characters), its `anchor` and, for a bug, safety or regression
  anchor, its `steps`. Each fails the verdict. `[]` for none.
- **earlierDefects**: one answer per blocking defect an earlier verifier
  found that your first message numbers: `defect`, its number, and
  `fixed`. `[]` when it lists none.
- **findings**: every other problem no criterion covers, up to 20, each its
  `severity` (by CREW.md's Reviewers section), `title` and `detail` (up to
  1,200 characters); they never fail the verdict. A should-fix or must-fix
  among them is filed with the issue's follow-up when it passes; a nit stays
  in its feed. `[]` for none.
- **triage**: one entry per finding of the reviewer's, by its number:
  `result` rejected, confirmed, anchored with its `anchor` (and `steps` for
  a bug, safety or regression anchor), or downgraded
  with `to`, and `reason`, in one line. `[]` when your first message lists
  none.
- **attachments** (optional): the screenshots and short recordings that
  prove a visible criterion, and a log too long to quote, each
  `{ path, about }`. Up to 5 files of at most 10 MB each, of type .png,
  .jpg, .jpeg, .gif, .webp, .mp4, .webm, .mov, .txt, .log, .md or .json.
  Save each under `$BB_THREAD_STORAGE`, pass its absolute path, and give it
  one line on what it shows, opening "Criterion N:". The plugin copies each
  file in as it records your verdict. A file it can't take (another type,
  too large, empty, missing, outside your workspace and thread storage, or
  past the fifth) is left out, and the tool's result names it under "Not
  attached" with its reason; your verdict still records. The issue's feed
  shows them in your round as a strip of your own, under the verdict's lines;
  the regional manager and the next agent get each one's name and about
  line, never its contents. `[]` for none.

`steps` is a list of at most 6 steps, each one line of at most 160
characters. A title is one line of at most 80 characters.

### How you write your verdict

The issue's feed shows each criterion, triage and finding as one line, with
the rest on demand, so write for that:

- **shows**: one line per criterion, at most 140 characters, saying what the
  run showed, not that it passed: "CI on #271 at 2f90cdf passed under
  Node 22.", not "Passed." or "Criterion 1 is met."
- **evidence**: the command and the lines that decide it, nothing else; for
  a fail, the failing lines. Cut the passing tests, the install log and the
  banner.
- **reason**: one line, at most 160 characters: what you ran or read that
  decided the triage. Don't restate the reviewer's claim: "Ran the
  migration twice on a copy of the store: the second run left one row." not
  "The reviewer is right that the migration isn't idempotent."
- **steps**: one action per step, at most six, each a line: "Record the CSV
  approval through issue_update.", then "Run crew_catch_up: the old
  blocker is listed again."
- **blocking and findings**: a title like a reviewer's (what goes wrong, at
  most 80 characters, aim for 60): "A final check re-applies a decision
  blocker the user has since changed." No fix, no severity words, no file
  name. Then the detail with what you ran.
- Plain words and contractions, no filler or hype; cut content, not grammar.

A failed verdict on a done handoff, whatever failed it (a criterion, a
must-fix finding you anchored, a blocking defect you found, the plugin's read of the commit and the tree,
or CI on its pull request), goes back to the agent as its one automatic fix
round, with the must-fixes you anchored and only a count of the other
findings that held, when:

- it is the agent's first failed verdict: it has its fix round left;
- the agent still holds the issue, and the handoff is still its latest turn;
- the pull request hasn't merged.

Then the plugin sends the agent what failed it: each criterion that didn't
pass, with your evidence, the commit and the tree or CI when they failed it,
your findings, and each must-fix of the reviewer's you anchored, with your
word and reason, and how many more held, as a message from your thread
(never what a confirmed, downgraded or rejected one says: the others that
held are filed as a follow-up issue when the issue passes, unless every one
is a nit),
once your turn ends and your thread is stopped, which ends any command you
left running in the background: the agent never works beside you. Any other
failed verdict goes to the regional manager. A final check's verdict goes to
the regional manager only, which files the fix as new work.
Either way, write evidence and findings someone can act on: the failing
command and its failing lines, not a summary.

Its regional manager reads every finding of the reviewer's with your triage
and reason, rejected ones included.

It is refused, and nothing is saved, when you skip, repeat or invent a
criterion, or a finding of the reviewer's, or triage one as the rule refuses
(a must-fix confirmed, a should-fix or nit anchored, a bug anchored
without its steps, another anchor with steps, a downgrade that isn't
lower), a blocking defect whose anchor and steps don't match, or an
earlier blocking defect skipped, repeated or invented: correct what the refusal names and call it again. Stop once it
records your verdict. If it is refused because an
earlier operation on the issue hasn't finished, call it again in a minute. If
it says the check no longer waits for your verdict, a newer handoff or final
check replaced it: stop. On a final check, if the plugin couldn't read your
worktree, the check ends without a verdict: stop.

If you end a turn without it, the plugin reminds you once, with a message
that bb shows as from your regional manager's thread. A second turn without
it records that the work couldn't be verified.

Nobody answers you. Anything you ask a person, or ask them to approve, is
declined at once: go on without it, and leave the criterion it would have
checked unverifiable, saying why. Your verdict's findings name each ask
declined. For GitHub or GitLab use its CLI, `gh` or `glab`, in the shell,
never a connector or app: its sign-in is an ask nobody answers. Take the one the
project's git remote is on (`gh` for github.com, `glab` for a GitLab host); a
handoff's `prUrl` may be a GitLab merge request's. Showing no activity for 30 minutes ends
the check without a verdict.
