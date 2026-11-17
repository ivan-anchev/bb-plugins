// The plugin's schema: one list, written whole, in the words of issues and agents. bb records each
// statement's hash by its index and rejects a changed or reused one, so from this release on the
// list only grows. Nothing here drops, renames or rewrites a table.
//
// why every table of the design from the start, issue_relations and issues.parent_id included:
// later releases then add no table, and the schema reads top to bottom in one place. Those two stay
// empty until dependencies and sub-issues write them.

export const MIGRATIONS: readonly string[] = [
  // A ticket is minted before its thread is spawned, and the thread's metadata carries it until bb
  // answers with the thread's id. why JSON: a role is read and written whole, never queried inside.
  `CREATE TABLE roles (ticket TEXT PRIMARY KEY, thread_id TEXT UNIQUE, role TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  // A regional manager. Its memory folder is named by its id; `verify` is whether its agents' done
  // handoffs get a verifier, the user's switch.
  `CREATE TABLE coordinators (id TEXT PRIMARY KEY, ticket TEXT NOT NULL UNIQUE REFERENCES roles (ticket),
     project_id TEXT NOT NULL, verify INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  // Each memory file's revision, and the version it was last seen at (null: it doesn't exist).
  `CREATE TABLE memory_revisions (coordinator_id TEXT NOT NULL REFERENCES coordinators (id), file TEXT NOT NULL, version TEXT,
     revision INTEGER NOT NULL, PRIMARY KEY (coordinator_id, file))`,

  // An issue, numbered i1, i2… per regional manager. why kind without a CHECK: a new kind is a
  // value of kindSchema, not a table rebuild. why JSON: the criteria and the verifier are read and
  // written whole; a null verifier lets the plugin pick. rest is where it sits while no agent's
  // work places it; closed_as is how the manager closed it.
  `CREATE TABLE issues (coordinator_id TEXT NOT NULL REFERENCES coordinators (id), id TEXT NOT NULL,
     kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, brief TEXT,
     done_criteria TEXT NOT NULL, verifier TEXT, parent_id TEXT,
     rest TEXT NOT NULL CHECK (rest IN ('backlog', 'todo')),
     closed_as TEXT CHECK (closed_as IN ('canceled', 'accepted')), closed_at INTEGER,
     created_at INTEGER NOT NULL, PRIMARY KEY (coordinator_id, id),
     FOREIGN KEY (coordinator_id, parent_id) REFERENCES issues (coordinator_id, id),
     CHECK ((closed_as IS NULL) = (closed_at IS NULL)))`,
  `CREATE INDEX issues_of_parent ON issues (coordinator_id, parent_id) WHERE parent_id IS NOT NULL`,
  // An issue depends on another. why a table: it is read from both sides ("blocks").
  `CREATE TABLE issue_relations (coordinator_id TEXT NOT NULL, issue_id TEXT NOT NULL, depends_on TEXT NOT NULL,
     PRIMARY KEY (coordinator_id, issue_id, depends_on),
     FOREIGN KEY (coordinator_id, issue_id) REFERENCES issues (coordinator_id, id),
     FOREIGN KEY (coordinator_id, depends_on) REFERENCES issues (coordinator_id, id))`,
  `CREATE INDEX issue_relations_blocks ON issue_relations (coordinator_id, depends_on)`,

  // An agent: one thread holding one issue for its life, numbered a1, a2… per regional manager, so
  // the ended_* columns end the assignment. Its thread is its ticket's. why JSON: placement, base and
  // execution are read and written whole. environment_id, branch and head are where its work was
  // last seen, read as it handed off; fix_rounds counts the failed verdicts sent back to it.
  `CREATE TABLE agents (coordinator_id TEXT NOT NULL REFERENCES coordinators (id), id TEXT NOT NULL, issue_id TEXT NOT NULL,
     ticket TEXT NOT NULL UNIQUE REFERENCES roles (ticket), placement TEXT NOT NULL, base TEXT NOT NULL, execution TEXT NOT NULL,
     environment_id TEXT, branch TEXT, head TEXT, fix_rounds INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL,
     ended_how TEXT, ended_at INTEGER, left_handoff_id TEXT,
     PRIMARY KEY (coordinator_id, id), FOREIGN KEY (coordinator_id, issue_id) REFERENCES issues (coordinator_id, id),
     CHECK ((ended_how IS NULL) = (ended_at IS NULL)))`,
  // why: an issue has at most one agent at a time, as a fact of the database that two agent_start
  // calls at once can't both pass.
  `CREATE UNIQUE INDEX agents_holding ON agents (coordinator_id, issue_id) WHERE ended_at IS NULL`,

  // An agent's handoff, as it wrote it (why JSON: read and written whole), and the turn it was made in.
  `CREATE TABLE handoffs (id TEXT PRIMARY KEY, coordinator_id TEXT NOT NULL, issue_id TEXT NOT NULL, agent_id TEXT NOT NULL,
     report TEXT NOT NULL, turn_seq INTEGER NOT NULL, at INTEGER NOT NULL,
     FOREIGN KEY (coordinator_id, agent_id) REFERENCES agents (coordinator_id, id),
     FOREIGN KEY (coordinator_id, issue_id) REFERENCES issues (coordinator_id, id))`,
  `CREATE INDEX handoffs_of_agent ON handoffs (coordinator_id, agent_id)`,
  `CREATE INDEX handoffs_of_issue ON handoffs (coordinator_id, issue_id)`,
  // A verifier's job and its verdict. why the subject as JSON: what a check judges is a variant
  // (check.ts), not a table. criteria and verifier are the issue's, copied when it was made.
  `CREATE TABLE checks (id TEXT PRIMARY KEY, coordinator_id TEXT NOT NULL, issue_id TEXT NOT NULL,
     handoff_id TEXT UNIQUE REFERENCES handoffs (id), subject TEXT NOT NULL, criteria TEXT NOT NULL,
     verifier TEXT, verdict TEXT NOT NULL, at INTEGER NOT NULL,
     FOREIGN KEY (coordinator_id, issue_id) REFERENCES issues (coordinator_id, id))`,
  `CREATE INDEX checks_of_issue ON checks (coordinator_id, issue_id)`,
  // The tick reads every check waiting for its verifier, and every returned verdict nobody has been told of.
  `CREATE INDEX checks_open ON checks (id) WHERE json_extract(verdict, '$.state') IN ('queued', 'running')`,
  `CREATE INDEX checks_unsettled ON checks (id) WHERE json_extract(verdict, '$.settlement.kind') IN ('pending', 'sending-back', 'waiting-for-ci')`,
  // A branch's pull request as the latest read that found one returned it (null: none has), with
  // when a read first saw its head commit, when this one was read, and the latest handoff as it
  // began; and, of every read, why the latest failed (null: it didn't), and when one was last tried.
  // why by branch: the pull request belongs to the branch, whichever agent works on it.
  `CREATE TABLE pr_snapshots (coordinator_id TEXT NOT NULL REFERENCES coordinators (id), branch TEXT NOT NULL,
     snapshot TEXT, head_seen_at INTEGER, read_at INTEGER, handoff_at_read TEXT, unavailable TEXT, polled_at INTEGER NOT NULL,
     PRIMARY KEY (coordinator_id, branch))`,

  // Everything the plugin tells a regional manager about, in the order recorded. A doorbell
  // announced it once announced_at is set; crew_catch_up returned it once read_at is.
  `CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, coordinator_id TEXT NOT NULL REFERENCES coordinators (id),
     event TEXT NOT NULL, at INTEGER NOT NULL, announced_at INTEGER, read_at INTEGER)`,
  `CREATE INDEX events_unread ON events (coordinator_id) WHERE read_at IS NULL`,
  `CREATE INDEX events_own_tree ON events (coordinator_id, id) WHERE json_extract(event, '$.kind') IN ('coordinator-edited-files', 'coordinator-tree-clean')`,
  // A doorbell bb queued and hasn't dispatched yet. While one is queued, no other is sent.
  `CREATE TABLE doorbells (coordinator_id TEXT PRIMARY KEY REFERENCES coordinators (id), queued_message_id TEXT NOT NULL UNIQUE)`,
  // A reminder: its note, when it is next due, and how often it repeats (null: once). why
  // AUTOINCREMENT here and on decisions: an id is never reused, so an old one can't reach a newer row.
  `CREATE TABLE reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, coordinator_id TEXT NOT NULL REFERENCES coordinators (id),
     note TEXT NOT NULL, due_at INTEGER NOT NULL, every_ms INTEGER)`,
  `CREATE INDEX reminders_due ON reminders (due_at)`,
  `CREATE INDEX reminders_of_coordinator ON reminders (coordinator_id)`,
  // A decision put to the user: its question, its options (why JSON: read and written whole), the
  // issue it flags Needs you until answered (null: none), and the user's answer once given.
  `CREATE TABLE decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, coordinator_id TEXT NOT NULL REFERENCES coordinators (id),
     issue_id TEXT, question TEXT NOT NULL, options TEXT NOT NULL, asked_at INTEGER NOT NULL, answer TEXT, answered_at INTEGER,
     FOREIGN KEY (coordinator_id, issue_id) REFERENCES issues (coordinator_id, id))`,
  `CREATE INDEX decisions_of_coordinator ON decisions (coordinator_id)`,
];
