---
name: import-pi-session
description: >-
  Import or move an external Pi coding agent session (.jsonl file) into Orchestra's
  System Assistant past chats so that the conversation can be viewed and resumed
  seamlessly in the web UI. Use when the user asks to move, import, migrate, or transfer
  a Pi session (e.g., from ~/.pi/agent/sessions/...) into Orchestra or System Assistant.
---

# Import Pi Session into Orchestra System Assistant

This skill guides you through migrating or importing external Pi coding agent conversation sessions (`.jsonl`) into Orchestra's System Assistant so they appear in past chats and can be seamlessly resumed from the web interface.

## Quick Start (Automated Script)

Run the bundled migration script:

```bash
# Move session (default)
node .agents/skills/import-pi-session/scripts/import-pi-session.mjs <session-file-path>

# Copy session (leave source file untouched)
node .agents/skills/import-pi-session/scripts/import-pi-session.mjs <session-file-path> --copy

# Dry-run validation
node .agents/skills/import-pi-session/scripts/import-pi-session.mjs <session-file-path> --dry-run
```

Optional CLI flags:
- `--copy`: Keep original file (default is `--move`).
- `--dry-run`: Test parse and output plan without making disk or database changes.
- `--data-dir=<dir>`: Target Orchestra data directory (defaults to `.data` or `$ORCHESTRA_DATA_DIR`).
- `--project=<projectId>`: Associate imported turns with a specific project context.
- `--title=<title>`: Custom thread title (defaults to the first user prompt truncated to 80 chars).

---

## What the Migration Performs

1. **Session Parsing & Integrity Check**:
   - Parses the Pi session JSONL to extract the session ID, model, provider, thinking level, and conversational turns.
   - Extracts all user messages, assistant responses, thinking traces, and tool results.
2. **File Migration**:
   - Places the `.jsonl` file in Orchestra's admin Pi sessions directory:
     `<dataDir>/admin-pi/sessions/<threadId>/<filename>.jsonl`
   - Verifies byte size and SHA-256 checksum match before unlinking the source file.
3. **Database Records Synchronization (`relay.sqlite`)**:
   - **`adminThreads`**: Stores thread metadata and binds the `sessionFile` pointer.
   - **`adminMessages`**: Populates chronological user and assistant chat messages.
   - **`adminRuns`**: Creates run entries for assistant executions with timestamps and thinking levels.
   - **`events`**: Inserts thinking traces and final output events linked to the run.
4. **Resumability Verification**:
   - Verifies the migrated file can be opened by `SessionManager.open(destFile)`.

For detailed data schemas and entity relationships, see [session-schema.md](./references/session-schema.md).

---

## Manual Verification Steps

After running the script, verify the conversation is accessible:

1. **Verify Database Records**:
   ```bash
   node -e '
   const { DatabaseSync } = require("node:sqlite");
   const db = new DatabaseSync(".data/relay.sqlite");
   const thread = db.prepare("SELECT data FROM records WHERE kind=? AND id=?").get("adminThreads", "<THREAD_ID>");
   console.log("Thread in DB:", JSON.parse(thread?.data || "null"));
   '
   ```
2. **Verify Session File Resumability**:
   ```bash
   node --input-type=module -e '
   import { SessionManager } from "@earendil-works/pi-coding-agent";
   const sm = SessionManager.open("<DEST_SESSION_FILE>");
   console.log("Session opens with", sm.getBranch().length, "entries");
   '
   ```
3. **Inform the User**:
   - Provide the **Thread ID**, **Title**, and **Session File Location**.
   - Direct the user to open **System Assistant** in the Orchestra web UI (`/assistant`), where the thread can be continued directly from the composer.
