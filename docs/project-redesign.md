# Project-first Orchestra

## Product model

Orchestra is a place to develop a project with agents, not a Git client with chat attached. A project can begin with a question, documents, research, decisions and goals, before there is any code repository.

The main objects are **Project → Conversation → Change → Task run**. Repositories, deployments and automations are project resources, not the definition of the project.

### Agent boundaries

- **System agent:** installation/host orchestration with explicit approvals or user-selected YOLO. Delegates repository work to visible task runs; does not perform repository edits itself. All delegations link back to the originating conversation.
- **Project coordinator:** persistent, project-scoped conversation with versioned project knowledge and live repository/worktree/change/session/automation context. Can update knowledge and delegate/steer tasks, but has no arbitrary host terminal.
- **Task agent:** Docker-isolated execution against a pinned repository/worktree. Outputs code, research, reviews or test evidence. Task transcripts are expandable execution evidence, not an alternative primary conversation.

## Information architecture

- Global navigation: Projects, Activity, System. Existing deep links remain valid during migration.
- Project workspace: overview/needs attention, knowledge explorer/editor, repositories, changes, recent task runs and automations. Empty projects invite capturing information, not importing a repository.
- Change workspace: title + lifecycle + clear next action. Conversation is primary. Changes has a searchable file navigator and line-anchored discussions; review and test evidence stays accessible without leaving the change. Secondary operational actions are grouped.
- A change has exactly one canonical project-level conversation. All design, research, implementation, review, tests and human feedback belong to it. Task runs link both ways.

## Knowledge storage

Each project has a dedicated metadata Git repository independent of its code repositories. Expose plain-text knowledge files (initially `knowledge.md`) from a versioned metadata document. Writes are serialized, path-safe, committed and attributed; editors can supply the read revision to reject concurrent overwrites. Existing projects initialize lazily without changing their code Git history. This is versioned knowledge, not a second database for ephemeral execution state: task/run status remains in SQLite.

## Change lifecycle

`Design → Research → Implement → Review → Test → Ready → Human merge`

Changes can be created before code exists, from the project’s New change action or coordinator’s `plan_change` tool. The initial source branch equals its target; an empty diff is expected until implementation. Stages are persisted and resumable. Review findings and failing tests lead to bounded address/review/test cycles, not unlimited retries. Missing configuration, access revocation, conflicts, cancelled/interrupted tasks and exhausted cycles are explicit blocked states. Existing repository approval policy still applies. No green stage without evidence; no automated merge merely because the pipeline is enabled. Review/test evidence is revision-bound and becomes stale after either branch changes.

## Review correctness

- Human-readable branches (`relay/<task-slug>-<unique-suffix>`), while retaining old branch compatibility.
- Follow-up work updates the existing change source using compare-and-swap; never silently opens a parallel change or overwrites newer work.
- A true merge conflict and an unavailable/failed merge check are different states.
- Source changes are compared to the target merge base. Generated/dependency content is hidden by default with explicit visibility controls; hiding is presentation only, never removal from the actual merge.
- File navigator, line numbers, old/new-side comments, revision anchoring and stale-comment indicators.
- Bounded diff output must say when truncated. Never truncate dependency noise before selecting the useful files.

## Delivery plan

1. Correctness foundations: conflict classification, safe publication, meaningful branches, filtered/structured diffs, anchored comments and regression tests.
2. Project knowledge Git and project-first dashboard. Preserve current URLs and data.
3. Canonical project/change coordinator conversations with scoped tools and linked Docker task runs.
4. Persisted bounded stage orchestration and evidence-driven readiness.
5. Browser/API/regression tests; exercise empty project, knowledge roundtrip, linked delegation, diff navigation, line comments, stale revisions and failure states.
6. Subsequent polish: migrate global navigation fully, threaded resolve/reopen code discussions, multi-repository changes, richer knowledge attachments/search/history UI, actionable notifications and live subscriptions instead of polling.

## Implemented in this pass

- Project directory/dashboard, independently versioned knowledge editor, persistent local drafts, read-only code explorer, linked activity and scoped coordinator conversation.
- Canonical change conversations; execution tasks remain visible in Sessions and linked back to their origin.
- Planned changes before implementation; persisted bounded pipeline and evidence UI, pause/stop/restart, no automatic merge. Current evidence is invalidated when revisions change.
- Read-only Docker design/research, isolated execution, project knowledge and review feedback supplied to task context.
- Lazy paginated diff manifests and per-file patches; explicit hidden/binary/oversized states; old/new line comments pinned to both revisions and validated against actual Git diffs.
- Meaningful new branches, existing-change follow-ups with compare-and-swap publication, stale-worktree protection, and automatic staging that excludes newly installed dependency/build directories without dropping tracked changes or lockfiles.
- Distinguish Git operational failures from true conflicts; unknown mergeability cannot enable the primary merge action.

Existing session/change URLs and stored records are preserved. The global navigation is intentionally incremental, not a destructive routing migration. Knowledge is versioned in `project.json` inside the metadata repository; logical document paths are not filesystem writes. Knowledge history HTTP endpoints exist; a history/diff UI and resolved threaded review discussions remain follow-up work.

## Acceptance and rollout

Do not rewrite existing sessions or change Git refs during migration. Old task and change URLs continue to work. Never test against production or the live `.data` directory. Use isolated temporary SQLite/Git fixtures and a separate local server for browser tests. Build/typecheck and existing suites are required; browser validation should use Chrome MCP where available. Unavailable credentials/services or skipped checks must be reported rather than called passing.

## Validation of this implementation

- `npm run build`: TypeScript and production build pass.
- `ORCHESTRA_DOCKER_TEST=1 npm test`: **113 passed, zero skipped**. Docker integration uses a deterministic loopback model fixture, not paid/live provider credentials. Includes the complete design/research/implement/review/test pipeline reaching ready without merging on an auto-capable repository.
- Real headless Chrome through Chrome DevTools MCP: project creation, repository-independent knowledge save/read/reload, project/change coordinator visibility, planned change creation with a meaningful branch and empty initial diff, file navigation, poll-safe inline drafts, new-side comments, and deleted-line old-side comments with exact row association after reload all pass. Reproduction: `tests/browser-redesign.md`.
- Browser tests are DOM-driven MCP interaction, not pointer-hit-testing, mobile or a complete accessibility audit. Actual live-provider quality and production rollout are not validated here.
- Existing production data was not used, rewritten or deployed. Existing uncommitted work was retained.
