# Persistence

> **Current persistence contract.** This document describes the checked-in storage implementation. It is not a migration plan.

## Storage map

| Data | Active store | Location / lifetime | Notes |
| --- | --- | --- | --- |
| Workspaces, settings, schema metadata, small runtime records | `electron-store` | Electron `userData` JSON | Schema version is currently `2`; workspace and settings writes use serialized mutation helpers where needed |
| Desktop session metadata and messages | `SqliteSessionRepository` | `userData/sessions.db` | Active repository; uses `node:sqlite` `DatabaseSync` |
| SQLite recovery copy | Repository backup | `userData/sessions.backup.db` | Refreshed on repository close when possible |
| Native Pi session history | Pi SDK `SessionManager` JSONL | `userData/pi-sessions/<deterministic-name>.jsonl` | Reopened when a desktop session resumes |
| Session image attachments | Filesystem (`SessionAttachmentStore`) | `userData/session-attachments/<sessionId>/` | Message rows store metadata (`attachments[]`); bytes stay on disk. Deleted with the session |
| Markdown memory | Markdown files plus SQLite index | `userData/memory/` and `userData/memory/index.sqlite` | The files are primary; the index supports search |
| Long-horizon tasks, goals, checkpoints | Main-process long-horizon services | Service-specific stores under `userData` or workspace artifacts | Do not describe these as part of the desktop session database |
| Compose run snapshots | `WorkflowRunStore` in memory | Process lifetime only | A full app restart loses active run state; spec/plan/report files remain if already written |

`electron-store` still has a legacy `sessions` field for migration compatibility. At schema version 2, startup marks the old session storage as `sqlite-v1`, clears the legacy array, and the active session IPC delegates to `SqliteSessionRepository`. Do not document the legacy JSON array as the current session backend.

## SQLite session repository

The repository creates `sessions.db` below its supplied root (the desktop passes `app.getPath("userData")`). It enables:

- WAL journaling, foreign keys, normal synchronous mode, and WAL auto-checkpointing;
- `sessions` metadata rows and `messages` rows with foreign-key cascade deletion;
- message ordering per session and `parent_id` for conversation trees/forks;
- JSON payload preservation for messages, tool calls, usage, tags, permissions, and fork metadata;
- an FTS5 `message_fts` table with trigram tokenization and triggers for insert/update/delete;
- bounded FTS search with substring post-filtering and a LIKE fallback for tokenizer edge cases;
- transactional message and tool-call updates, duplicate message protection, and repository health checks.

The repository exposes session CRUD, summaries, message append/update, tool-call update, search, statistics, health, and close operations through the `SessionRepository` interface. IPC input is validated before these methods receive renderer data.

## Startup and recovery

On open, the repository runs SQLite `PRAGMA quick_check`. If the primary database is unhealthy or cannot be opened, it quarantines the database and its WAL/SHM companions with a timestamped `.corrupt-*` suffix. It validates the backup with `quick_check` and restores it when healthy; otherwise it opens a new database and lets migrations recreate the schema. This is best-effort recovery, not a promise that corrupted data can always be restored.

On close, the repository attempts a WAL checkpoint and copies the primary database to `sessions.backup.db`. Shutdown paths should close it once and tolerate best-effort checkpoint/backup failures while logging them.

## Native Pi session continuity

The desktop session database contains the UI's session metadata and message projection. The live Pi SDK conversation state is separate. `resolveNativeSessionPath` deterministically maps the desktop session ID to a JSONL file under `userData/pi-sessions/`; resuming a desktop session opens that file through the Pi SDK's `SessionManager`.

Therefore:

- restoring a rendered message list is not equivalent to restoring the live Pi context;
- deleting/forking a desktop session must account for both the repository record and its native session path;
- tests that claim resume must verify the native session path behavior, not only renderer state.

## Write and migration rules

- Keep persistence operations behind service/repository interfaces rather than reaching into SQLite from renderer code.
- Keep all SQL parameters bound; never interpolate renderer-controlled values into SQL.
- Add schema migrations in order and update the current schema version in the same change.
- Preserve unknown message payload fields when updating a message; the repository stores the normalized full JSON payload.
- Treat session writes as independent from streaming UI rendering. A failed persistence call must be surfaced/logged without blocking the event bridge.
- Add a focused repository test for every new field, migration, recovery branch, or search behavior.

## Operational checks

For persistence changes, run the desktop repository tests and the normal repository gate:

```bash
pnpm --filter @pi-desktop/desktop test -- src/main/services/__tests__/sqlite-session-repository.test.ts
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

The test suite uses temporary roots for SQLite files. Do not use a developer's real Electron `userData` directory as a test fixture.
