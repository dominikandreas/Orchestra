import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';

const dir = await mkdtemp(join(tmpdir(), 'orchestra-planned-'));
process.env.RELAY_DATA_DIR = dir;
const store = await import('../src/server/store.js');
const git = await import('../src/server/git.js');
const planner = await import('../src/server/planned-change.js');
const pipelines = await import('../src/server/change-pipeline.js');
const metadata = await import('../src/server/project-metadata.js');
afterEach(() => { for (const p of store.all('changePipelines')) store.del('changePipelines', p.id); });
after(async () => { store.db.close(); await rm(dir, { recursive: true, force: true }); });

async function fixture(autonomy = 'prepare') {
  const project = store.put('projects', { name: 'Calendar', description: 'Scheduling for teams' });
  const user = store.put('users', { role: 'member', projects: [project.id] });
  const path = join(dir, `source-${project.id}`);
  await git.createLocalRepository(path, 'Calendar');
  const repo = await git.importRepository(path, 'Calendar', project.id, 'main');
  store.put('repos', { id: repo.id, autonomy, requireReview: true });
  const input = { repoId: repo.id, title: 'Add calendar reminders', description: 'Notify participants before meetings.' };
  const plan = (extra: any = {}) => planner.planProjectChange(project.id, { ...input, ...extra }, user);
  return { project, user, repo, path, input, plan };
}

async function snapshot(repo: any) {
  return { rows: store.all('changes'), threads: store.all('projectThreads'), pipelines: store.all('changePipelines'), jobs: store.all('jobs'), branches: await git.branchDetails(repo) };
}

test('plans without code changes: unique meaningful source, pinned empty diff, saved request and canonical conversation', async () => {
  const f = await fixture();
  const before = await git.revision(f.repo, 'main');
  const c = await f.plan();
  assert.match(c.source, /^relay\/add-calendar-reminders-[0-9a-f-]{36}$/);
  assert.equal(c.target, 'main');
  assert.equal(c.sourceSha, before);
  assert.equal(c.targetSha, before);
  assert.equal(await git.revision(f.repo, c.source), before);
  assert.equal(await git.diffChange(c), '');
  assert.equal(c.description, f.input.description);
  assert.equal(c.status, 'open');
  assert.equal(c.threadId, store.hash(JSON.stringify(['project-conversation', f.project.id, c.id])));
  assert.equal(store.get('projectThreads', c.threadId)!.changeId, c.id);
  assert.ok(c.pipeline);
  assert.equal(c.pipeline.stage, 'design');
  assert.equal(c.pipeline.currentJobId, null);
  assert.equal(store.all('jobs').length, 0);
  const second = await f.plan({ startPipeline: false });
  assert.notEqual(second.source, c.source);
  assert.equal(second.pipeline, null);
  assert.equal(store.get('changePipelines', second.id), undefined);
  assert.equal(await git.revision(f.repo, 'main'), before);
});

test('existing non-base target is used, not main or an arbitrary revision expression', async () => {
  const f = await fixture();
  await git.git(f.path, 'checkout', '-b', 'release');
  await writeFile(join(f.path, 'release.txt'), 'release');
  await git.git(f.path, 'add', '.');
  await git.git(f.path, 'commit', '-m', 'Release baseline');
  const releaseSha = await git.git(f.path, 'rev-parse', 'HEAD');
  await git.git(f.repo.path, 'fetch', 'origin', 'release:release');
  const c = await f.plan({ target: 'release', startPipeline: false });
  assert.equal(c.target, 'release');
  assert.equal(c.sourceSha, releaseSha);
  assert.equal(c.targetSha, releaseSha);
  assert.equal(await git.diffChange(c), '');
});

test('polling queues read-only design first with metadata and requested model; approval policy is retained', async () => {
  const f = await fixture('approve');
  await metadata.createProjectMetadata(f.project.id, { name: 'Calendar', description: 'Accessible scheduling', knowledge: 'All reminders must respect user timezones.' });
  const c = await f.plan({ connectionId: 'later-provider', model: 'selected-model', thinkingLevel: 'high' });
  const calls: any[] = [];
  const dependencies = { enqueue(input: any, actor: any) {
    calls.push(input);
    return store.put('jobs', { ...input, authorId: actor.id, status: input.autonomy === 'approve' && input.kind === 'implement' ? 'awaiting_approval' : 'queued' });
  } };
  const tick = () => pipelines.advanceChangePipelines(dependencies);
  const state = () => store.get('changePipelines', c.id)!;
  tick(); tick();
  assert.equal(calls.length, 1);
  const design = calls[0];
  assert.equal(design.kind, 'review');
  assert.equal(design.changeId, undefined);
  assert.equal(design.sourceBranch, c.source);
  assert.equal(design.targetBranch, c.source);
  assert.equal(design.connectionId, 'later-provider');
  assert.equal(design.model, 'selected-model');
  assert.equal(design.thinkingLevel, 'high');
  assert.equal(design.autonomy, 'approve');
  assert.match(design.prompt, /Design the requested change/);
  assert.match(design.prompt, /do not edit files/i);
  assert.match(design.prompt, /Notify participants/);
  assert.match(design.prompt, /respect user timezones/);
  assert.equal(store.get('jobs', state().currentJobId)!.projectThreadId, c.threadId);
  for (const artifact of ['Design artifact', 'Research artifact']) {
    store.put('jobs', { id: state().currentJobId, status: 'completed', result: artifact });
    tick();
  }
  assert.equal(state().stage, 'implement');
  assert.equal(store.get('jobs', state().currentJobId)!.status, 'awaiting_approval');
  assert.equal(calls[2].sourceBranch, c.source);
  assert.equal(store.get('changes', c.id)!.status, 'open');
  assert.equal(await git.revision(f.repo, c.target), c.targetSha);
});

test('no provider is required at creation; the real queue may be blocked later without deleting the plan', async () => {
  const f = await fixture('auto');
  const c = await f.plan();
  assert.ok(c.pipeline);
  assert.equal(c.pipeline.settings.autonomy, 'prepare');
  const { enqueue } = await import('../src/server/jobs.js');
  pipelines.advanceChangePipelines({ enqueue });
  const p = store.get('changePipelines', c.id)!;
  assert.equal(store.get('jobs', p.currentJobId)!.status, 'blocked');
  pipelines.advanceChangePipelines({ enqueue });
  assert.equal(store.get('changePipelines', c.id)!.status, 'paused');
  assert.equal(store.get('changes', c.id)!.status, 'open');
  assert.equal(await git.revision(f.repo, c.source), c.sourceSha);
  assert.equal(store.get('repos', f.repo.id)!.autonomy, 'auto');
});

test('invalid input and targets do not mutate records or branches', async () => {
  const f = await fixture();
  const before = await snapshot(f.repo);
  for (const extra of [
    { title: '' }, { title: '   ' }, { description: 'x'.repeat(10001) },
    { thinkingLevel: 'unlimited' }, { startPipeline: 'false' }, { source: 'existing' },
    { target: 'missing' }, { target: 'main~0' }, { target: '--all' }, { target: 'main..bad' },
    { connectionId: '' }, { model: '' }, { autonomy: 'auto' },
  ]) {
    await assert.rejects(f.plan(extra));
    assert.deepEqual(await snapshot(f.repo), before);
  }
});

test('project scope, ready repository and fresh persisted user permissions are required', async () => {
  const f = await fixture();
  const other = await fixture();
  const before = await snapshot(f.repo);
  await assert.rejects(f.plan({ repoId: other.repo.id }), /belong to project/);
  for (const status of ['importing', 'error']) {
    store.put('repos', { id: f.repo.id, status });
    await assert.rejects(f.plan(), /not ready/);
  }
  store.put('repos', { id: f.repo.id, status: 'ready' });
  for (const patch of [{ role: 'viewer' }, { role: 'member', disabled: true }, { disabled: false, projects: [] }]) {
    store.put('users', { id: f.user.id, ...patch });
    // The original caller object still claims membership and operation rights.
    await assert.rejects(f.plan(), /access denied/);
  }
  store.del('users', f.user.id);
  await assert.rejects(f.plan(), /access denied/);
  assert.deepEqual(await snapshot(f.repo), before);
});

test('pipeline persistence failure rolls back the created CR, conversation and branch', async () => {
  const f = await fixture();
  const before = await snapshot(f.repo);
  store.db.exec(`CREATE TEMP TRIGGER reject_planned_pipeline BEFORE INSERT ON records WHEN NEW.kind = 'changePipelines' BEGIN SELECT RAISE(ABORT, 'simulated pipeline failure'); END;`);
  try { await assert.rejects(f.plan(), /simulated pipeline failure/); }
  finally { store.db.exec('DROP TRIGGER reject_planned_pipeline'); }
  assert.deepEqual(await snapshot(f.repo), before);
});

test('POST route accepts a plan and uses authenticated user with fresh permissions', async () => {
  const f = await fixture();
  const app = Fastify();
  app.setErrorHandler((error: any, _req, reply) => reply.code(400).send({ error: error.message }));
  app.addHook('preHandler', async (req: any) => { req.user = f.user; });
  planner.registerPlannedChangeRoutes(app);
  try {
    const url = `/api/projects/${f.project.id}/changes`;
    const response = await app.inject({ method: 'POST', url, payload: { ...f.input, startPipeline: false } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().description, f.input.description);
    assert.equal(response.json().pipeline, null);
    store.put('users', { id: f.user.id, role: 'viewer' });
    const before = await snapshot(f.repo);
    assert.equal((await app.inject({ method: 'POST', url, payload: f.input })).statusCode, 400);
    assert.deepEqual(await snapshot(f.repo), before);
  } finally { await app.close(); }
});
