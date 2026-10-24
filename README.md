# Orchestra

A private software orchestration workspace with Pi agents, local change requests, project-level access, durable automation, and isolated Docker previews.

## Run

Requires Node.js 22.19+ (24 recommended), Git, and a running Docker daemon accessible to the service user.

```sh
npm ci
npm run build
npm start
```

Dashboard: `http://localhost:4310`. The first single-use owner invitation is saved in `.data/bootstrap-url` (expires after 24 hours). Open that URL, enter your name, create a project, import a repository, and add a provider in **Settings & connections**. Select its model in repository settings. No password is needed. Browser access tokens live in local storage; provider credentials are encrypted on the server.

Install a persistent Linux user service:

```sh
node scripts/install-service.mjs
systemctl --user status orchestra-workspace
journalctl --user -u orchestra-workspace -f
```

The service starts with the user's systemd session. Enable user lingering through your system administrator if it must run before login. No public tunnel is created.

## Software workflow

Projects group multiple repositories. Imports create managed **bare clones** and isolated worktrees; your original checkout is not modified. Orchestra polls repository heads every 30 seconds, fetching new source commits and fast-forwarding managed refs where safe. Divergent refs are retained and reported. Changes merge into the **managed clone**, not automatically back into the original repository. Fetch a managed branch into your original checkout when ready:

```sh
git fetch /absolute/path/to/orchestra/.data/repos/REPOSITORY_ID main
git merge FETCH_HEAD
```

Change requests contain pinned source/target revisions, comments, reviews, diffs, and test evidence. Tests run against the candidate merge. Changing either revision invalidates old gates. Required reviews and tests are checked again under the repository lock before compare-and-swap updates to Git refs. GitHub/GitLab hosted PR synchronization is not included in this local-first release.

Every AI job uses the Pi TypeScript SDK. Its shell tool runs in an unprivileged Docker container mounting only the job worktree, with `.git` read-only. Repository tools cannot access the Docker socket or provider credential store. The model process receives only its selected provider connection. Test/preview commands run in containers with CPU, memory, and process limits. Container networking is enabled for dependency installation. This is intended for repositories and collaborators you trust; Docker is not a hostile-code security boundary.

Select one of three autonomy levels: approval before edits, automatic preparation/manual merge (default), or automatic merging when required checks pass. Repository settings cap job/workflow autonomy. Automatic merge also requires an explicit test command. AI reviews can submit a structured verdict. Direct human reviews are supported. Recurring schedules use minute intervals; event workflows cover new/updated changes, comments, conflicts, and failed tests. Event jobs are deduplicated, bounded to three attempts per workflow/change, and do not trigger their own originating workflow.

An **Adapt** task can propose versioned prompts, skills, extensions, and disabled workflow drafts. Activate drafts in Automations. Extensions are TypeScript syntax-checked and require an admin to activate; an activated extension is trusted server code and can extend Pi's tools. Prompt changes cannot change server-side permissions or merge gates.

## Provider connections

Providers and models come from Pi's catalog. API keys, browser OAuth, device codes, and manual authorization responses are shown using Pi's native authentication interfaces. Ambient-only cloud providers need their normal server-side configuration. Administrators can add custom endpoints for supported API formats. Personal connections are restricted to their owner; shared connections are granted to projects. Losing provider access blocks unattended jobs until repaired. A real provider account is not bundled.

## Access and recovery

Owner/admin users manage members, project access, credentials, and executable extensions. Operators run work on assigned projects; viewers inspect them. Invitations are single-use, expire after 24 hours, and can be revoked. Devices are independently revocable. Only owners can manage ownership, and the last active owner cannot be disabled.

```sh
npm run cli -- users
npm run cli -- invite "User Name"   # another device for an existing user
npm run cli -- invite               # a new viewer, with no projects initially
npm run cli -- recover              # fresh owner recovery invitation
npm run cli -- revoke DEVICE_ID
```

Use the same `ORCHESTRA_DATA_DIR` and `ORCHESTRA_BASE_URL` as the service when invoking the CLI. Anyone with OS-level access to the service data directory can recover ownership; keep that directory private.

## Previews

Configure a preview command (for example `npm ci && npm run dev -- --host 0.0.0.0`) and its container port. Launch from a task or the Previews page. Docker chooses a loopback-only host port; Orchestra proxies it through a separate preview origin on port 4311, including WebSocket upgrades. Open with a short-lived grant, exchanged for an HttpOnly cookie; the dashboard token is never forwarded. Previews stop after 30 minutes without requests. Logs and explicit stop controls are available.

## Updating Orchestra with Orchestra

Admins can register this app as a repository from **Settings → Maintenance**. Run normal tasks against it, review/test/merge its change requests, then build a release. Release installation and checks run in Docker. An admin must activate a successful build. Activation restarts the systemd service through a launcher retaining the previous release; startup failures within 30 seconds automatically restore that version. A manual rollback is also available. Quiesce active jobs before activating or rolling back.

## Configuration and persistence

- `ORCHESTRA_DATA_DIR`: defaults to `.data` in the checkout.
- `PORT` / `ORCHESTRA_HOST`: defaults to `4310` / `0.0.0.0` for private LAN/VPN access.
- `ORCHESTRA_BASE_URL`: public-to-your-devices dashboard origin for invite links.
- `ORCHESTRA_PREVIEW_PORT` / `ORCHESTRA_PREVIEW_URL`: defaults to `4311` / the dashboard hostname with that port.
- `ORCHESTRA_TLS_CERT` / `ORCHESTRA_TLS_KEY`: optional PEM paths enabling HTTPS on both listeners. Use a trusted certificate when connecting over an untrusted network. Default private-network installation serves HTTP.

Legacy `RELAY_*` environment variables remain supported; `ORCHESTRA_*` takes precedence. The service installer migrates the previous `relay-workspace` service to `orchestra-workspace`. Existing database filenames, browser storage keys, Git branch prefixes, and container identifiers are retained for compatibility, so existing installations keep their data and device sign-ins.

SQLite uses WAL and schema version 1. Back up the entire data directory **including `master.key`**, with the service stopped or using a SQLite-consistent backup. Losing the key loses access to encrypted provider credentials. Session logs, artifacts, releases, and worktrees persist for inspection. The service marks in-flight jobs interrupted after restart; users explicitly resume them rather than repeating side effects automatically.

## Verification

```sh
npm test
ORCHESTRA_DOCKER_TEST=1 npm test
npm run build
npm audit
```

Core tests cover access control, invite reuse/expiry, device revocation, original-checkout preservation, stale merge gates, approval restrictions, encryption/redaction, and owner protection. The Docker suite runs the actual Pi worker against a deterministic local OpenAI-compatible streaming fixture, executes a tool, commits a change request, and tests the candidate. It does not require or consume a paid provider account.
