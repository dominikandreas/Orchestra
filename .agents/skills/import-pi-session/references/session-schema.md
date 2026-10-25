# Orchestra System Assistant & Pi Session Integration

This document details how external Pi coding agent sessions are integrated into Orchestra's System Assistant chat system.

## 1. Storage Locations

### External Pi Sessions
- Pi saves session logs in JSONL format under:
  `~/.pi/agent/sessions/<workspace-slug>/<timestamp>_<sessionId>.jsonl`
- Each line is a JSON record representing an event: `session`, `model_change`, `thinking_level_change`, or `message` (with `user`, `assistant`, or `system` role).

### Orchestra Admin Pi Sessions
- Orchestra runs its System Assistant using an embedded Pi agent located at `<dataDir>/admin-pi`.
- Sessions are stored at:
  `<dataDir>/admin-pi/sessions/<threadId>/<filename>.jsonl`
- The `sessionFile` field in the database record points directly to this file.
- When an administrator sends a subsequent message to the thread, Orchestra invokes `SessionManager.open(thread.sessionFile)`, loading previous turns and seamlessly appending new turns to the same file.

## 2. Database Entities (`relay.sqlite`)

Orchestra persists records in `records` table (`kind`, `id`, `data`) and streaming events in `events` table (`seq`, `job`, `type`, `data`, `created`).

### `adminThreads`
```json
{
  "id": "<threadId>",
  "created": "<ISO-timestamp>",
  "authorId": "<userId>",
  "title": "<thread-title>",
  "permissionMode": "manual",
  "updated": "<ISO-timestamp>",
  "connectionId": "<connectionId>",
  "model": "<modelId>",
  "thinkingLevel": "medium",
  "sessionFile": "<absolute-path-to-session-jsonl>"
}
```

### `adminMessages`
- **User Message:**
  ```json
  {
    "id": "<uuidv7>",
    "threadId": "<threadId>",
    "role": "user",
    "text": "<prompt-text>",
    "context": { "page": "assistant", "projectId": "<projectId>" },
    "images": [],
    "attachments": [],
    "created": "<timestamp>",
    "updated": "<timestamp>"
  }
  ```
- **Assistant Message:**
  ```json
  {
    "id": "<uuidv7>",
    "threadId": "<threadId>",
    "role": "assistant",
    "text": "<response-text>",
    "runId": "<runId>",
    "created": "<timestamp>",
    "updated": "<timestamp>"
  }
  ```

### `adminRuns`
```json
{
  "id": "<runId>",
  "threadId": "<threadId>",
  "authorId": "<userId>",
  "title": "<short-task-summary>",
  "status": "completed",
  "context": { "page": "assistant", "projectId": "<projectId>" },
  "thinkingLevel": "medium",
  "created": "<first-timestamp>",
  "updated": "<last-timestamp>",
  "finished": "<last-timestamp>"
}
```

### `events`
Streaming event rows linked to the assistant run (`job = <runId>`):
- `type: "thinking"`: Holds JSON-stringified intermediate thinking traces.
- `type: "result"`: Holds JSON-stringified final response text.

## 3. Resuming Sessions

When resuming in the Orchestra web UI:
1. Navigation: Click the thread in the **System Assistant** chat list.
2. The UI fetches `/api/admin/threads/:id` to retrieve messages and runs.
3. When the user sends a new turn, `startAdminTurn()` opens `thread.sessionFile` via `SessionManager.open()`.
4. Subsequent turns are saved to both the JSONL file and SQLite.
