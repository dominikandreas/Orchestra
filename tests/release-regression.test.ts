// Release-review reproductions. Uses only disposable data/Git repositories.
// Assertions describe the required safe behavior; failures reproduce release bugs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

const root = await mkdtemp(join(tmpdir(), 'orchestra-release-regression-'));
process.env.RELAY_DATA_DIR = join(root, 'data');
process.env.ORCHESTRA_DATA_DIR = process.env.RELAY_DATA_DIR;
delete process.env.RELAY_TLS_CERT;
delete process.env.RELAY_TLS_KEY;
const s = await import('../src/server/store.js');
const g = await import('../src/server/git.js');
const jobs = await import('../src/server/jobs.js');
const metadata = await import('../src/server/project-metadata.js');
const coordinator = await import('../src/server/project-agent.js');
const control = await import('../src/server/admin-control.js');
const { createApp } = await import('../src/server/app.js');

after(async () => { await control.waitForAdminActions(); s.db.close(); await rm(root, { recursive: true, force: true }); });
async function until(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 2000; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 10)); }
  throw Error('Fixture wait timed out');
}
async function fixture(name: string) {
  const project = s.put('projects', { name });
  const user = s.put('users', { role: 'operator', projects: [project.id], name: 'Operator' });
  const path = join(root, name); await mkdir(path);
  await g.git(path, 'init', '-b', 'main');
  await g.git(path, 'config', 'user.name', 'Release test');
  await g.git(path, 'config', 'user.email', 'release@example.invalid');
  await writeFile(join(path, 'file.txt'), 'base\n');
  await g.git(path, 'add', '.'); await g.git(path, 'commit', '-m', 'Base');
  const repo = await g.importRepository(path, name, project.id, 'main');
  return { project, user, repo };
}
function connection(user: any) {
  return s.put('connections', { ownerId: user.id, status: 'connected' });
}

test('follow-up publication must not make the original task silently revert newer work', async () => {
  const { repo, user } = await fixture('checked-out-source');
  const originalPath = await g.createWorktree(repo, 'original-task', 'main', 'Original implementation');
  await writeFile(join(originalPath, 'file.txt'), 'original implementation\n');
  await g.git(originalPath, 'add', '.'); await g.git(originalPath, 'commit', '-m', 'Original');
  const originalSha = await g.git(originalPath, 'rev-parse', 'HEAD');
  const source = await g.git(originalPath, 'branch', '--show-current');
  const change = await g.createChange(repo, source, 'main', 'Feature', user.id);
  const original = s.put('jobs', { repoId: repo.id, projectId: repo.projectId, authorId: user.id, path: originalPath,
    changeId: change.id, sourceSha: originalSha, status: 'completed', title: 'Original implementation' });
  const followupPath = await g.createWorktree(repo, 'followup-task', originalSha, 'Address feedback');
  await writeFile(join(followupPath, 'file.txt'), 'newer reviewed fix\n');
  const followup = s.put('jobs', { repoId: repo.id, projectId: repo.projectId, authorId: user.id, path: followupPath,
    changeId: change.id, sourceSha: originalSha, status: 'completed', title: 'Address feedback' });
  const published = await jobs.submitChangeForJob(followup, repo, user);
  // A safe publisher may detach the old workspace at its original baseline.
  // An unsafe publisher moves its symbolic HEAD while leaving files/index old.
  assert.equal(await readFile(join(originalPath, 'file.txt'), 'utf8'), 'original implementation\n');
  assert.equal(await g.revision(repo, source), published.change.sourceSha);
  let error: unknown;
  try { await jobs.submitChangeForJob(original, repo, user); } catch (e) { error = e; }
  const actual = await g.git(repo.path, 'show', `${source}:file.txt`);
  assert.equal(actual, 'newer reviewed fix', `Stale original task overwrote the follow-up; submission error: ${String(error)}`);
});

test('refresh must not restore a stale open row after close, merge, or deletion', async () => {
  const { repo, user } = await fixture('refresh-race');
  await g.git(repo.path, 'branch', 'feature', 'main');
  const outcomes: any[] = [];
  for (const state of ['closed', 'merged', 'deleted']) {
    const c = await g.createChange(repo, 'feature', 'main', state, user.id);
    const pending = g.refreshChange(c); // suspends for Git, just like GET /api/changes/:id
    if (state === 'deleted') s.del('changes', c.id);
    else s.put('changes', { id: c.id, status: state });
    try { await pending; } catch (e) { if (state !== 'deleted') throw e; }
    outcomes.push({ expected: state, actual: s.get('changes', c.id)?.status ?? 'deleted' });
  }
  assert.deepEqual(outcomes, [
    { expected: 'closed', actual: 'closed' }, { expected: 'merged', actual: 'merged' }, { expected: 'deleted', actual: 'deleted' },
  ]);
});

test('a queued coordinator knowledge write must not persist after membership revocation', async () => {
  const project = s.put('projects', { name: 'Revoked knowledge writer' });
  const user = s.put('users', { role: 'operator', projects: [project.id] });
  const c = connection(user);
  const knowledge = await metadata.projectKnowledge(project);
  const thread = coordinator.projectThread(user.id, project.id);
  const run = s.put('projectRuns', { authorId: user.id, projectId: project.id, threadId: thread.id, status: 'running' });
  let unlock!: () => void; let entered!: () => void;
  const enteredPromise = new Promise<void>(r => { entered = r; });
  const held = g.locked(`project-knowledge:${project.id}`, async () => { entered(); await new Promise<void>(r => { unlock = r; }); });
  await enteredPromise;
  const tool = coordinator.projectTools(run, { connectionId: c.id, model: 'fixture' }).find(t => t.name === 'save_project_knowledge')!;
  const writing = tool.execute('save', { path: 'knowledge.md', content: 'written after revocation', revision: knowledge.revision });
  s.put('users', { id: user.id, projects: [] });
  unlock(); await held;
  await assert.rejects(writing, /access denied/); // the post-call guard rejects, but too late
  const final = await metadata.projectKnowledge(project);
  assert.equal(final.revision, knowledge.revision, 'The rejected/revoked tool call still committed knowledge');
});

test('lazy knowledge initialization must be readable by concurrent first callers', async () => {
  const errors: string[] = [];
  for (let i = 0; i < 4; i++) {
    const project = { id: `lazy-init-${i}`, name: 'Lazy project' };
    const first = metadata.ensureProjectKnowledge(project);
    await until(() => existsSync(metadata.projectMetadataPath(project.id)));
    const result = await Promise.allSettled([first, metadata.ensureProjectKnowledge(project)]);
    for (const r of result) if (r.status === 'rejected') errors.push(String(r.reason));
  }
  assert.deepEqual(errors, [], 'A concurrent reader observed an uninitialized metadata repository');
});

test('stopping a coordinator while plan_change waits must not create a new executing pipeline', async () => {
  const { project, repo, user } = await fixture('cancelled-planner');
  const c = connection(user);
  const thread = coordinator.projectThread(user.id, project.id);
  const run = s.put('projectRuns', { authorId: user.id, projectId: project.id, threadId: thread.id, status: 'running' });
  let unlock!: () => void; let entered!: () => void;
  const enteredPromise = new Promise<void>(r => { entered = r; });
  const held = g.locked(repo.id, async () => { entered(); await new Promise<void>(r => { unlock = r; }); });
  await enteredPromise;
  const tool = coordinator.projectTools(run, { connectionId: c.id, model: 'fixture' }).find(t => t.name === 'plan_change')!;
  const planning = tool.execute('plan', { repoId: repo.id, title: 'Should not start after stop' });
  await coordinator.stopProjectTurn(user.id, project.id);
  unlock(); await held;
  await assert.rejects(planning, /no longer running/);
  assert.equal(s.all('changePipelines').filter(p => p.projectId === project.id && p.status === 'running').length, 0,
    'Cancelled tool call created an active pipeline before its post-call guard rejected');
});

test('cancelling a task must invalidate its pending host command approval', async () => {
  const owner = s.put('users', { role: 'owner' });
  const job = s.put('jobs', { authorId: owner.id, status: 'running' });
  const marker = join(root, 'cancelled-host-command');
  const action = control.proposeAction(owner.id, 'Task host operation', { kind: 'host', command: `printf executed > '${marker}'`, cwd: root, timeout: 5 });
  s.put('adminActions', { id: action.id, jobId: job.id });
  jobs.signalJob(job.id, 'cancel');
  try { await control.decideAction(action.id, 'approve', owner.id); } catch { /* rejection is safe */ }
  await control.waitForAdminActions();
  assert.equal(existsSync(marker), false, 'Approved host command still executed after its owning task was cancelled');
});

test('project operators must not get arbitrary host execution by creating an MCP server', async () => {
  const project = s.put('projects', { name: 'MCP privilege boundary' });
  const actor = s.redeemInvite(s.issueInvite(undefined, 'operator', [project.id]).token, 'Operator');
  const marker = join(root, 'operator-host-execution');
  const app = await createApp();
  try {
    const response = await app.inject({ method: 'POST', url: '/api/mcp-servers', headers: { authorization: `Bearer ${actor.token}` },
      payload: { name: 'Not an MCP server', projectId: project.id, type: 'stdio', enabled: false,
        command: '/bin/sh', args: ['-c', `printf escaped > '${marker}'`] } });
    if (response.statusCode === 200) await until(() => existsSync(marker));
    assert.equal(existsSync(marker), false, `Operator POST returned ${response.statusCode} and executed a host command without approval`);
  } finally { await app.close(); }
});

test('SIGTERM shutdown must not publish an unfinished task as completed', {
  skip: (process.env.ORCHESTRA_DOCKER_TEST || process.env.RELAY_DOCKER_TEST) !== '1', timeout: 60000,
}, async () => {
  const { project, repo, user } = await fixture('shutdown-publication');
  let waitingForModel = false;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const input = JSON.parse(body);
    if (input.messages.some((m: any) => m.role === 'tool')) {
      waitingForModel = true; // Hold the model response: implementation is not finished.
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: any, finish_reason: any = null) => res.write(`data: ${JSON.stringify({
      id: 'shutdown-fixture', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'write-partial', type: 'function', function: {
      name: 'workspace', arguments: JSON.stringify({ command: "printf 'unfinished candidate\\n' > partial.txt" }),
    } }] });
    chunk({}, 'tool_calls'); res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  let running: Promise<void> | undefined;
  try {
    const c = s.put('connections', { ownerId: user.id, provider: 'shutdown-fixture', status: 'connected',
      secret: s.encrypt({ type: 'api_key', key: 'disposable-fixture-only' }), config: {
        name: 'Shutdown fixture', api: 'openai-completions', baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
        models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 32000,
          maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      } });
    const job = jobs.enqueue({ repoId: repo.id, connectionId: c.id, model: 'fixture', title: 'Unfinished implementation',
      prompt: 'Write a partial implementation then continue working.', kind: 'implement', autonomy: 'prepare' }, user);
    running = jobs.runJob(job);
    await until(() => {const current=s.get('jobs',job.id)!;if(current.status==='failed')throw Error(current.error);return waitingForModel;});
    await jobs.shutdownJobs();
    const atShutdownReturn = { status: s.get('jobs', job.id)!.status,
      publishedChanges: s.all('changes').filter(ch => ch.projectId === project.id).length };
    await running;
    const final = s.get('jobs', job.id)!;
    const published = s.all('changes').filter(ch => ch.projectId === project.id);
    assert.deepEqual({ status: final.status, publishedChanges: published.length }, { status: 'interrupted', publishedChanges: 0 },
      `SIGTERM was treated as a successful worker exit and published the partial implementation; already at shutdown return: ${JSON.stringify(atShutdownReturn)}`);
  } finally {
    if (running) { await jobs.shutdownJobs(); await running; }
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
  }
});

test('viewers must not receive MCP authentication headers/environment secrets', async () => {
  const project = s.put('projects', { name: 'MCP secret boundary' });
  const viewer = s.redeemInvite(s.issueInvite(undefined, 'viewer', [project.id]).token, 'Viewer');
  const secret = 'release-fixture-sensitive-token';
  const server = s.put('mcpServers', { projectId: project.id, name: 'Authenticated service', enabled: false,
    type: 'sse', url: 'https://example.invalid/mcp', env: { Authorization: `Bearer ${secret}` } });
  const app = await createApp();
  try {
    const response = await app.inject({ url: '/api/mcp-servers', headers: { authorization: `Bearer ${viewer.token}` } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes(secret), false, 'Read-only project viewer received an MCP credential');
  } finally { s.del('mcpServers', server.id); await app.close(); }
});
