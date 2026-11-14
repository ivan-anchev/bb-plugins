---
name: activity-sidebar
description: Explain the Activity Sidebar plugin, which replaces bb's thread list with one Activity list of every parent thread from every project, latest first, with pinned threads above it, the Working, Asleep and Archived shelves folded at its foot, a project filter and a Compact switch for one or two lines a row, each row showing the thread's agent, project initial, title, running subthreads and its state or age, with a right-click menu (including Sleep and Wake), a hover Archive button and a hover card with the thread's details, its plan while it works and its subthread tree. Use when the user asks what the Activity list shows, why a thread is or isn't in it, what a row's corner glyph means, what the shelves, the filter and the Compact switch do, how Sleep works and when a sleeping thread wakes, what a row's menu, its hover Archive button and its hover card do, or how to switch back to bb's own list.
---

# Activity Sidebar

The Activity Sidebar plugin replaces the scrolling thread list in bb's sidebar.
The New thread button, search, navigation and footer stay bb's. It has no
commands and no settings.

## What the list shows

- **Pinned**, only while a thread is pinned, in bb's own pin order.
- **Activity**: every parent thread from every project that isn't under way,
  the one that most recently came back first: its turn ended or failed.
  Opening or reading a thread doesn't move it. Subthreads and hidden helper
  threads have no row; a parent counts its running subthreads instead.
- Below a gap that fills the rest of the sidebar, the **shelves**:
  - **Working**: unpinned threads under way (running, connecting, or waiting
    on what will wake them: background work, or a subthread still under way
    whose end bb reports back to it). When a turn starts, the thread leaves
    Activity for Working; when it ends with nothing left to wake it, it
    returns to the top of Activity. A thread whose wait just ended stays on
    Working for 10 seconds while the wakes it brings start its next turn (a
    short reply in between doesn't send it to Activity), so an orchestrator
    that waits on its subthreads doesn't flash Completed on Activity between
    rounds. Asking for you or failing ends that early. A subthread with parent
    notifications set to `stuck` or `off` doesn't hold its parent.
  - **Asleep**: threads put to sleep (see Sleep below), the soonest to wake
    first, each showing how soon it wakes.
  - **Archived**: bb's archived parent threads, latest archived first, each
    showing how long ago it was archived.

  An empty shelf is left out. When the list is longer than the sidebar, the
  shelves follow Activity and you scroll down to them.

## Folding, the project filter and Compact

- Click a section's title to fold or unfold it. Pinned and Activity start
  open; the shelves start folded. A folded title shows how many threads it
  holds. Archived counts every archived parent thread bb holds, in the
  filtered project, however many rows have loaded; until that count arrives
  its title shows no number. If reading it fails, the title shows no number
  and "Couldn't count archived threads · Retry" sits under it, folded or not.
- Opened, Archived shows its latest 10 and a "Show 25 more" row. Past what is
  loaded, it reads "Show more" and loads the next page. If a page fails to
  load, the shelf says "Couldn't load archived threads · Retry".
- The view button at the end of Activity's title narrows Pinned, Activity
  and every shelf to one project; the title then reads "Activity · project".
  Choose "All projects" to show everything again.
- The same menu's Compact switch picks the density. On (the default), a row
  is one line. Off, each row grows to two: under its title, its branch behind
  a branch glyph, then its machine, each when bb names one.
- The folds, the filter and the density are kept in this browser's local storage, so they
  survive a reload but aren't shared with other clients.

## Motion

- A row that changes place glides there (180 to 240 ms, longer for longer
  moves): a thread starting work slides down into Working, and finishing, back
  to the top. A row that arrives in a section opens in and fades in; one that
  leaves (archived, deleted, put to sleep) fades and closes, and the rows
  around it slide to close the gap.
- Unfolding a section opens it over 260 ms, its rows fading in once there is
  room; folding fades them out first, then closes.
- The working ring turns: eight dashes stretch around it, then rest, every
  ring on screen in step.
- With the system's Reduce motion on, nothing moves: rows take their places at
  once, the hover card appears without a fade, and the rings stand still.
  Turning it on mid-move stops the move where it is and shows the list as it
  now stands.

## A row

From left to right:

1. The agent's mark, faint unless the row has a state or is open.
2. The project's tile: its initial on a colour hashed from the project id, the
   same colour every time.
3. The title, fading out at its end when it doesn't fit. Rest the pointer on
   the row and, after a beat, a title that doesn't fit runs through to its
   end; it slides back when the pointer leaves. With Reduce motion on, it
   stays still.
4. Its pull request, when the thread's branch has one: its state's glyph and
   its number, green while open, grey as a draft, violet once merged (the merge
   glyph), red when closed (the crossed-out glyph). Hover it for its state and
   title. It comes from bb's GitHub PR Status plugin; with that plugin off, or
   `gh` unavailable, no badge shows.
5. A pill with how many threads run under it (its own background agents plus
   every running subthread), when any do.
6. The corner, which holds exactly one of:
   - a state glyph: a turning dashed ring for working, connecting (blue) or waiting on
     background work or subthreads; a speech bubble for awaiting input; an amber shield for
     pending approval (the agent asks leave to run something); a green check for
     done (an unread finished turn); a red mark for failed; a yellow alarm
     clock for woke from sleep;
   - on Asleep, how soon it wakes, rounded up: `45m`, `3h`, `2d`;
   - otherwise how long ago the thread last moved: `now`, `5m`, `3h`, `2d`,
     `1w`.

While bb's jump modifier (⌘) is held, the corner shows the row's jump key.

The open thread's row is highlighted; when a subthread is open, its parent's
row is. A row with a state, or the open one, has a brighter, medium-weight
title.

## A row's menu

Right-click a row, or focus it and press the Menu key or Shift+F10. There is no
⋯ button. The menu is bb's own thread menu, the one bb's list opens, so it holds
the same items in the same order and behaves the same: Rename edits the title
in place (see below), archiving a thread with subthreads asks first, an archive
offers Undo, Delete always asks, and failures show bb's error toast.

The list adds one item to it: **Sleep** ▸ its times, or **Wake** while the
thread sleeps (see Sleep below). Pinned and archived rows have neither.

## The corner's Archive button

Under the pointer, a row's corner swaps its state or time for an Archive
button in the same place (Unarchive on the Archived shelf). Pressing it runs
bb's own Archive, as the menu's does, and never opens the thread. While bb's jump
modifier is held, the corner shows the jump key instead.

It works while the agent is working, as in Zeron: bb archives the thread at
once and stops its agent. If the thread has subthreads, bb asks first and warns
"This will stop current work."

## Sleep

Sleep puts a thread out of the way until a time. Its submenu lists, soonest
first, each as "name · when": **In 1 hour**, **In 3 hours**, **This evening**
(6:00 PM, while still ahead), **Tomorrow** (9:00 AM) and **Next week** (Mon
9:00 AM; on a Monday, the one a week on). Times already past are left out, and
two that fall on the same minute show once. **Custom…** opens a dialog on
tomorrow at 9:00 AM; it accepts only a time still ahead and says the moment in
words under its title.

- The thread moves to **Asleep** at once and its corner counts down.
- At its time it returns to the top of Activity, ranked by when it woke, with
  the yellow **Woke** glyph. The list checks once a minute, so this can take up
  to a minute. Opening the thread clears the glyph.
- **Wake** in a sleeping row's menu brings it back now, with the Woke glyph.
- A sleeping thread that asks you something, needs an approval or fails wakes
  early and for good: it shows what it asks, and once answered it shows Woke
  rather than going back to sleep. One that only works or finishes stays
  asleep.
- Pinned and archived threads don't sleep.
- Sleep times live in the plugin's own database on the bb server, so a reload
  or another client shows the same shelf. bb itself, its CLI and `bb thread
  list` know nothing of them. If they can't be read, the list shows every
  thread with "Couldn't load sleep times · Retry" above it; a read that fails
  after one that worked keeps the shelf as last read and shows the same line.
- A write the server refuses says so in a toast: "Couldn't put this chat to
  sleep", "Couldn't wake this chat" (Wake, or a sleeper waking early), or
  "Couldn't mark this chat as seen" (clearing Woke on opening). The row goes
  back to how it was, and the list doesn't try that write again.

## The hover card

Rest the pointer on a row for about half a second, or move keyboard focus to
it with ↑/↓, and its card opens to the right of the row, kept inside the
window. It shows:

- the title, up to three lines;
- its state and since when: "Working · for 4m" (counted from when the list
  first saw it start, so opening the thread doesn't reset it), "Completed ·
  5m ago", "Asleep · wakes at 9:00 AM", or just "3h ago";
- the machine it runs on (left out when bb doesn't know it), its project, and
  its branch, with "· worktree off main" for a worktree;
- its pull request's title and badge, when it has one;
- while it works, its plan: bb's to-do list for the thread (filled by an agent
  that keeps one, e.g. Claude Code's task tools), as "Todo 3/9" and its steps,
  each a green check (done), the working ring (in progress) or a faint ring
  (pending). Past six steps it shows three, the step in progress and one
  either side, with "2 earlier" / "4 later"; pressing either shows the whole
  plan while the card stays open. The plan follows the agent live: a step it
  completes shows completed in the open card. No plan, or a thread that isn't
  working, shows no Todo section. When reading the plan fails, the section
  says so with Retry: "Couldn't load the plan", or "Couldn't update the plan"
  above the steps last read, which may be out of date;
- its subthreads as a tree, each a small row: agent mark, title, and its state
  or how long ago it moved. Subthreads in the thread's own checkout hang off it
  directly; those in another checkout hang under that branch's head ("worktree
  · 2"), worktrees on one branch counted together. Busy subthreads, and the
  path down to them, come first; of the quiet ones only the two latest per
  place show; the tree stops at 12 lines. The header counts every subthread
  and those running. Click a subthread to open it; "Show all N" (when some are
  left out) opens the thread itself.

The card is never taller than the window. When an open plan and the subthreads
would run past it, the title and its lines stay put and the plan and subthreads
scroll under them, their edges fading where there is more to scroll. Scrolling
inside the card keeps it open.

The card has no latest-message text. Once one card is open, resting on another
row swaps it at once, and within 0.4 s of one closing the next opens at once.
The pointer can travel diagonally across other rows to reach the card; it
switches only if the pointer stops on another row. The card stays while the
pointer or keyboard focus is on its row or on the card; once both have left,
it closes after a moment. Escape (wherever focus is), a click or right-click
in the list, and scrolling close it, and so does its row leaving (filtered
out, archived, put to sleep or moved to another shelf). There is no card on a
phone-width screen.

From the keyboard: with a row focused and its card open, Tab moves into the
card: first to the plan and subthreads as a whole, which ↑, ↓, Page Up, Page Down,
Home and End scroll, then to its plan folds, Retry and subthreads; Enter unfolds the plan or opens a subthread. Shift+Tab off the first, or Escape,
goes back to the row; Tab past the last goes on to what follows the list. When the plan or subthreads change
under focus (a fold the next step no longer needs, a Retry that worked, the plan ending), focus stays in the
card: on the plan and subthreads as a whole, or on the card itself once neither is left. When
the card closes with focus in it, focus goes back to its row, or to the next
row when its own has left the list.

## Renaming

Double-click a row, or choose Rename from its menu, and the title becomes a
field with the whole title selected. Enter or clicking away keeps a changed
name; Escape, or an empty field, keeps the old one. Titles are cut at 200
characters.

## Using it

- Click a row to open the thread. Drag it toward the main area to open it in a
  split.
- Tab to the list, then use ↑ and ↓ to move between rows and section titles.
  Enter opens a row or folds a title. The filter button is the next Tab stop.

## Switching back

bb shows the first thread list a plugin registers. To use bb's own list, open
Settings → Appearance → Sidebar and pick it; the choice is per client.
