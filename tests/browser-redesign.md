# Isolated redesign browser smoke

Run from the repository root with Node 22+ and Chrome installed. This is opt-in and does not add dependencies or modify MCP configuration.

```sh
# Point at an installed chrome-devtools-mcp CLI JavaScript entry point.
export CHROME_MCP_BIN=/path/to/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js
node tests/browser-redesign-smoke.mjs

# Include deleted-line anchoring and persistence after reload.
BROWSER_SMOKE_OLD_SIDE=1 node tests/browser-redesign-smoke.mjs
```

The local cached MCP CLI discovered during development was:
`/home/dominik/.npm/_npx/15c61037b1978c83/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js`.
`pi mcp list` reported no configured servers. The runner talks JSON-RPC stdio directly to this Chrome MCP server; no child agent or credential-bearing Pi configuration is required.

## Safety

- Creates a new `/tmp/orchestra-browser-redesign-*` directory before dynamically importing the server/store; no `.data` records are read or written.
- Creates a local Git fixture with two modified files (including a path with spaces), added/deleted lines, and a disposable owner account.
- Uses `createApp()`, **not** server/index: no worker queue, deployment recovery, bootstrap, or production listener.
- Starts Fastify and Vite on ephemeral loopback ports. The browser runner accepts no existing application URL.
- Launches headless Chrome with `--isolated`, disables MCP usage statistics/CrUX, and never attaches to a personal browser.
- Cleans the fixture on normal exit and test failure. A forced kill can leave a disposable temp directory.

## Coverage

- Browser authentication against the fixture.
- Project creation through the UI and persistence via state API.
- Project knowledge edit/save, API readback with revision, and full reload persistence in a project with zero repositories.
- Visible project coordinator composer after creation and reload; sending disabled without a configured model provider.
- Selects Browser fixture using the project filter (no Home/sidebar label dependency), opens the project-header New change modal, selects its existing repository, and fills title plus goal/acceptance criteria.
- With no provider configured, creates without a pipeline or queued jobs; asserts canonical `/changes/:id` navigation with the change conversation visible, persisted title/goal and scoped canonical thread, a real title-based branch pinned to main, and an initially empty API/UI file diff. Saves planned-change readback and screenshots, then returns to the original fixture change for inline smoke.
- Change deep-link and navigation to Changes/Conversation.
- Switching changed files, including a filename with spaces.
- Added-line comment input, survival of a 3-second poll, submission, file/line/side/sourceSha/targetSha persistence, and visibility after tab switch and full reload.
- Optional deleted-line comment verifies `side: old`, both revisions, and displayed persistence after reload.

The runner uses DOM-driven controls through MCP `evaluate_script`; this verifies React rendering/handlers and real HTTP persistence, not physical pointer/keyboard hit testing. It intentionally does not start agents, access provider credentials, merge code, deploy containers, or assert AI behavior.

Screenshots/tool schemas are saved under `/tmp/orchestra-redesign/browser-smoke` (override `BROWSER_SMOKE_OUTPUT`). Set `BROWSER_SMOKE_PROBE=1` to skip new-project/knowledge creation and print initial DOM controls; planned-change creation and the remaining change/comment tests still run. Set `CHROME_BIN` to override `/usr/bin/google-chrome`.

## Final planned-change QA

After `registerPlannedChangeRoutes(app)` was present, the extended smoke passed with `BROWSER_SMOKE_OLD_SIDE=1` using the cached MCP CLI above:

```sh
CHROME_MCP_BIN=/home/dominik/.npm/_npx/15c61037b1978c83/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js \
BROWSER_SMOKE_OLD_SIDE=1 BROWSER_SMOKE_OUTPUT=/tmp/orchestra-redesign/final-browser \
node tests/browser-redesign-smoke.mjs
```

Log: `/tmp/orchestra-redesign/final-browser.log`. Report: `/tmp/orchestra-redesign/final-browser-summary.md`. Planned-change evidence: `planned-change-result.json`, `06-planned-conversation.png`, and `07-planned-empty-diff.png` in that artifact directory. Existing new/old inline checks run against the original non-empty fixture after planned-change assertions.

## Follow-up coverage

Run `npx tsx --test tests/redesign-api.test.ts` for isolated createApp integration coverage: repository-independent versioned knowledge/history/stale-write rejection, viewer/project authorization, old/new inline anchors and stale-ref races, structured manifest/lazy patches, canonical conversations, pipeline start/read/stop registration. It does not execute agents or workers.

Remaining browser coverage: knowledge new-file/conflict handling, viewer permissions, binary/renamed/deleted files, dependency hiding, browser history, mobile overflow, focus and keyboard interactions, live coordinator/delegated sessions, and failed API recovery. Build/typechecking and full API suites are separate checks.
