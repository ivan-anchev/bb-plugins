export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE roles (ticket TEXT PRIMARY KEY, thread_id TEXT UNIQUE, role TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE coordinators (id TEXT PRIMARY KEY, ticket TEXT NOT NULL UNIQUE REFERENCES roles (ticket),
     project_id TEXT NOT NULL, verify INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  `CREATE TABLE memory_revisions (coordinator_id TEXT NOT NULL REFERENCES coordinators (id), file TEXT NOT NULL, version TEXT,
     revision INTEGER NOT NULL, PRIMARY KEY (coordinator_id, file))`,

  `CREATE TABLE issues (coordinator_id TEXT NOT NULL REFERENCES coordinators (id), id TEXT NOT NULL,
     kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, brief TEXT,
     done_criteria TEXT NOT NULL, verifier TEXT, parent_id TEXT,
     rest TEXT NOT NULL CHECK (rest IN ('backlog', 'todo')),
     closed_as TEXT CHECK (closed_as IN ('canceled', 'accepted')), closed_at INTEGER,
     created_at INTEGER NOT NULL, PRIMARY KEY (coordinator_id, id),
     FOREIGN KEY (coordinator_id, parent_id) REFERENCES issues (coordinator_id, id),
     CHECK ((closed_as IS NULL) = (closed_at IS NULL)))`,
  `CREATE INDEX issues_of_parent ON issues (coordinator_id, parent_id) WHERE parent_id IS NOT NULL`,
  `CREATE TABLE issue_relations (coordinator_id TEXT NOT NULL, issue_id TEXT NOT NULL, depends_on TEXT NOT NULL,
     PRIMARY KEY (coordinator_id, issue_id, depends_on),
     FOREIGN KEY (coordinator_id, issue_id) REFERENCES issues (coordinator_id, id),
     FOREIGN KEY (coordinator_id, depends_on) REFERENCES issues (coordinator_id, id))`,
  `CREATE INDEX issue_relations_blocks ON issue_relations (coordinator_id, depends_on)`,

  `CREATE TABLE agents (coordinator_id TEXT NOT NULL REFERENCES coordinators (id), id TEXT NOT NULL, issue_id TEXT NOT NULL,
     ticket TEXT NOT NULL UNIQUE REFERENCES roles (ticket), placement TEXT NOT NULL, base TEXT NOT NULL, execution TEXT NOT NULL,
     environment_id TEXT, branch TEXT, head TEXT, fix_rounds INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL,
     ended_how TEXT, ended_at INTEGER, left_handoff_id TEXT,
     PRIMARY KEY (coordinator_id, id), FOREIGN KEY (coordinator_id, issue_id) REFERENCES issues (coordinator_id, id),
     CHECK ((ended_how IS NULL) = (ended_at IS NULL)))`,
  `CREATE UNIQUE INDEX agents_holding ON agents (coordinator_id, issue_id) WHERE ended_at IS NULL`,

  `CREATE TABLE handoffs (id TEXT PRIMARY KEY, coordinator_id TEXT NOT NULL, issue_id TEXT NOT NULL, agent_id TEXT NOT NULL,
     report TEXT NOT NULL, turn_seq INTEGER NOT NULL, at INTEGER NOT NULL,
     FOREIGN KEY (coordinator_id, agent_id) REFERENCES agents (coordinator_id, id),
     FOREIGN KEY (coordinator_id, issue_id) REFERENCES issues (coordinator_id, id))`,
  `CREATE INDEX handoffs_of_agent ON handoffs (coordinator_id, agent_id)`,
  `CREATE INDEX handoffs_of_issue ON handoffs (coordinator_id, issue_id)`,
  `CREATE TABLE checks (id TEXT PRIMARY KEY, coordinator_id TEXT NOT NULL, issue_id TEXT NOT NULL,
     handoff_id TEXT UNIQUE REFERENCES handoffs (id), subject TEXT NOT NULL, criteria TEXT NOT NULL,
     verifier TEXT, verdict TEXT NOT NULL, at INTEGER NOT NULL,
     FOREIGN KEY (coordinator_id, issue_id) REFERENCES issues (coordinator_id, id))`,
  `CREATE INDEX checks_of_issue ON checks (coordinator_id, issue_id)`,
  `CREATE INDEX checks_open ON checks (id) WHERE json_extract(verdict, '$.state') IN ('queued', 'running')`,
  `CREATE INDEX checks_unsettled ON checks (id) WHERE json_extract(verdict, '$.settlement.kind') IN ('pending', 'sending-back', 'waiting-for-ci')`,
  `CREATE TABLE pr_snapshots (coordinator_id TEXT NOT NULL REFERENCES coordinators (id), branch TEXT NOT NULL,
     snapshot TEXT, head_seen_at INTEGER, read_at INTEGER, handoff_at_read TEXT, unavailable TEXT, polled_at INTEGER NOT NULL,
     PRIMARY KEY (coordinator_id, branch))`,

  `CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, coordinator_id TEXT NOT NULL REFERENCES coordinators (id),
     event TEXT NOT NULL, at INTEGER NOT NULL, announced_at INTEGER, read_at INTEGER)`,
  `CREATE INDEX events_unread ON events (coordinator_id) WHERE read_at IS NULL`,
  `CREATE INDEX events_own_tree ON events (coordinator_id, id) WHERE json_extract(event, '$.kind') IN ('coordinator-edited-files', 'coordinator-tree-clean')`,
  `CREATE TABLE doorbells (coordinator_id TEXT PRIMARY KEY REFERENCES coordinators (id), queued_message_id TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, coordinator_id TEXT NOT NULL REFERENCES coordinators (id),
     note TEXT NOT NULL, due_at INTEGER NOT NULL, every_ms INTEGER)`,
  `CREATE INDEX reminders_due ON reminders (due_at)`,
  `CREATE INDEX reminders_of_coordinator ON reminders (coordinator_id)`,
  `CREATE TABLE decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, coordinator_id TEXT NOT NULL REFERENCES coordinators (id),
     issue_id TEXT, question TEXT NOT NULL, options TEXT NOT NULL, asked_at INTEGER NOT NULL, answer TEXT, answered_at INTEGER,
     FOREIGN KEY (coordinator_id, issue_id) REFERENCES issues (coordinator_id, id))`,
  `CREATE INDEX decisions_of_coordinator ON decisions (coordinator_id)`,

  `ALTER TABLE issue_relations ADD COLUMN known_close TEXT`,

  [
    `CREATE TABLE fact_writes (coordinator_id TEXT PRIMARY KEY, writes INTEGER NOT NULL)`,
    ...["issues", "issue_relations", "agents", "handoffs", "checks", "pr_snapshots", "decisions"].flatMap((table) => [
      countWrites(`${table}_inserted`, `INSERT ON ${table}`, "NEW.coordinator_id"),
      countWrites(`${table}_updated`, `UPDATE ON ${table}`, "NEW.coordinator_id"),
      countWrites(`${table}_deleted`, `DELETE ON ${table}`, "OLD.coordinator_id"),
    ]),
    countWrites("roles_bound", "UPDATE OF thread_id ON roles", "json_extract(NEW.role, '$.coordinatorId')"),
  ].join(";\n"),

  `ALTER TABLE coordinators ADD COLUMN description TEXT`,
  `ALTER TABLE coordinators ADD COLUMN avatar TEXT NOT NULL DEFAULT '{"kind":"icon","icon":"Workflow"}'`,

  `ALTER TABLE coordinators ADD COLUMN awaiting_goal INTEGER NOT NULL DEFAULT 0`,

  `ALTER TABLE coordinators ADD COLUMN name TEXT`,

  `CREATE TABLE issue_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, coordinator_id TEXT NOT NULL, issue_id TEXT NOT NULL,
     text TEXT NOT NULL, at INTEGER NOT NULL,
     FOREIGN KEY (coordinator_id, issue_id) REFERENCES issues (coordinator_id, id))`,
  `CREATE INDEX issue_decisions_of_issue ON issue_decisions (coordinator_id, issue_id)`,

  `ALTER TABLE coordinators ADD COLUMN issue_key TEXT`,
];

function countWrites(name: string, on: string, manager: string): string {
  return `CREATE TRIGGER ${name} AFTER ${on} BEGIN
     INSERT INTO fact_writes (coordinator_id, writes) VALUES (${manager}, 1) ON CONFLICT (coordinator_id) DO UPDATE SET writes = writes + 1;
   END`;
}
