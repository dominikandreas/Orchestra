import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';

const dir = await mkdtemp(join(tmpdir(), 'orchestra-pipeline-'));
process.env.RELAY_DATA_DIR = dir;
const store = await import('../src/server/store.js');
const pipeline = await import('../src/server/change-pipeline.js');
after(async () => { store.db.close(); await rm(dir, { recursive: true, force: true }); });

function fixture(autonomy = 'prepare') {
  const project = store.put('projects', { name: 'Pipeline' });
  const user = store.put('users', { role: 'member', projects: [project.id] });
  const repo = store.put('repos', { projectId: project.id, autonomy, testCommand: 'npm test' });
  const change = store.put('changes', { repoId: repo.id, projectId: project.id, title: 'Feature', source: 'feature/existing', target: 'main', sourceSha: 'source', targetSha: 'target', status: 'open', conflict: false });
  const calls: any[] = [];
  const dependencies = {
    enqueue(input: any, actor: any) {
      calls.push(input);
      return store.put('jobs', { ...input, authorId: actor.id, status: input.kind === 'implement' && autonomy === 'approve' ? 'awaiting_approval' : 'queued' });
    },
    cancel(id: string) { store.put('jobs', { id, status: 'cancelled' }); },
  };
  const state = () => pipeline.getChangePipeline(change.id)!;
  const tick = () => pipeline.advanceChangePipelines(dependencies);
  const job = () => store.get('jobs', state().currentJobId)!;
  const complete = (extra: any = {}) => {
    store.put('jobs', { id: job().id, status: 'completed', result: `${state().stage} artifact`, sourceSha: 'source', targetSha: 'target', ...extra });
    tick();
  };
  const review = (verdict = 'approved') => {
    store.put('reviews', { jobId: job().id, changeId: change.id, sourceSha: 'source', targetSha: 'target', verdict, body: 'Findings' });
    complete();
  };
  const check = (status = 'passed') => {
    store.put('checks', { jobId: job().id, changeId: change.id, sourceSha: 'source', targetSha: 'target', status, log: 'test output' });
    complete({ status: status === 'failed' ? 'failed' : 'completed' });
  };
  const start = (settings: any = {}) => { pipeline.startChangePipeline(change.id, settings, user); tick(); };
  return { user, repo, change, dependencies, calls, state, tick, job, complete, review, check, start };
}

test('design/research are read-only, artifacts flow forward, existing source reused, ready never merges', () => {
  const f = fixture();
  f.start({ connectionId: 'provider', model: 'model', thinkingLevel: 'high', autonomy: 'auto' });
  assert.equal(f.job().kind, 'review');
  assert.equal(f.job().changeId, undefined);
  assert.equal(f.job().targetBranch, f.change.source);
  assert.match(f.job().prompt, /do not edit files/i);
  f.complete();
  assert.equal(f.state().stage, 'research');
  assert.equal(f.job().kind, 'review');
  assert.equal(f.job().changeId, undefined);
  assert.match(f.job().prompt, /design artifact/);
  f.complete();
  assert.equal(f.state().stage, 'implement');
  assert.equal(f.job().changeId, f.change.id);
  assert.equal(f.job().sourceBranch, f.change.source);
  assert.equal(f.job().autonomy, 'prepare');
  assert.equal(f.job().connectionId, 'provider');
  assert.equal(f.job().thinkingLevel, 'high');
  assert.equal(f.job().pipelineId, f.change.id);
  assert.match(f.job().prompt, /research artifact/);
  f.complete(); f.review(); f.check();
  assert.equal(f.state().status, 'ready');
  assert.equal(f.state().evidence.length, 5);
  assert.equal(f.state().evidence[3].reviews[0].verdict, 'approved');
  assert.equal(f.state().evidence[4].checks[0].status, 'passed');
  assert.equal(store.get('changes', f.change.id)!.status, 'open');
  f.tick(); assert.equal(f.calls.length, 5);
});

test('ready evidence becomes paused after either revision changes and pipeline tasks share the change conversation', () => {
  const f=fixture();f.start();
  const threadId=f.job().projectThreadId;
  assert.equal(store.get('projectThreads',threadId)!.changeId,f.change.id);
  f.complete();assert.equal(f.job().projectThreadId,threadId);
  f.complete();f.complete();f.review();f.check();
  assert.equal(f.state().status,'ready');
  store.put('changes',{id:f.change.id,targetSha:'new-target'});f.tick();
  assert.equal(f.state().status,'paused');assert.match(f.state().reason,/revisions changed/);
  assert.equal(f.calls.length,5);
});

test('rejecting review and failing tests trigger at most three address/review/test cycles', () => {
  const f = fixture(); f.start(); f.complete(); f.complete(); f.complete();
  f.review('changes_requested'); f.check();
  for (let cycle = 1; cycle <= 3; cycle++) {
    assert.equal(f.state().stage, 'address');
    assert.equal(f.state().repairCycles, cycle);
    assert.equal(f.job().sourceBranch, f.change.source);
    assert.match(f.job().prompt, /Findings/);
    f.complete(); f.review(); f.check('failed');
  }
  assert.equal(f.state().status, 'blocked');
  assert.match(f.state().reason, /3 repair cycles/);
  assert.equal(f.calls.length, 14);
  f.tick(); assert.equal(f.calls.length, 14);
});

test('successful repair reaches ready only after fresh review and tests', () => {
  const f = fixture(); f.start(); f.complete(); f.complete(); f.complete();
  f.review(); f.check('failed');
  f.complete(); f.review(); f.check();
  assert.equal(f.state().status, 'ready');
  assert.equal(f.state().repairCycles, 1);
});

test('polling persisted pointers is idempotent across queue waits and restart-style calls', () => {
  const f = fixture('approve'); f.start();
  const firstId = f.state().currentJobId;
  for (let i = 0; i < 5; i++) pipeline.advanceChangePipelines(f.dependencies);
  assert.equal(f.state().currentJobId, firstId);
  assert.equal(f.calls.length, 1);
  f.complete(); f.complete();
  assert.equal(f.job().status, 'awaiting_approval');
  f.tick(); f.tick(); assert.equal(f.calls.length, 3);
  store.put('jobs', { id: f.job().id, status: 'interrupted' });
  f.tick(); assert.equal(f.state().status, 'paused');
  f.tick(); assert.equal(f.calls.length, 3);
  assert.equal(f.state().evidence.length, 3);
});

test('blocked/cancelled/interrupted tasks pause, and actual conflicts do not dispatch repair', () => {
  for (const status of ['blocked', 'cancelled', 'interrupted']) {
    const f = fixture(); f.start();
    store.put('jobs', { id: f.job().id, status });
    f.tick(); assert.equal(f.state().status, 'paused');
    assert.match(f.state().reason, new RegExp(status));
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(); f.start();
  store.put('changes', { id: f.change.id, conflict: true });
  f.tick(); assert.equal(f.state().status, 'paused');
  assert.match(f.state().reason, /Actual merge conflict/);
  assert.equal(f.calls.length, 1);
});

test('tests not configured, not run, missing review and stale evidence cannot be ready', () => {
  for (const mode of ['unconfigured', 'not_run', 'missing', 'stale', 'drift']) {
    const f = fixture(); f.start(); f.complete(); f.complete(); f.complete();
    if (mode === 'missing') {
      f.complete(); assert.equal(f.state().status, 'paused'); continue;
    }
    f.review();
    if (mode === 'unconfigured') store.put('repos', { id: f.repo.id, testCommand: '' });
    if (mode === 'drift') store.put('changes', { id: f.change.id, targetSha: 'new-target' });
    if (mode === 'stale') {
      store.put('checks', { jobId: f.job().id, changeId: f.change.id, sourceSha: 'old', targetSha: 'target', status: 'passed' });
      f.complete();
    } else f.check(mode === 'not_run' ? 'not_run' : 'passed');
    assert.ok(['blocked', 'paused'].includes(f.state().status), mode);
    assert.notEqual(f.state().status, 'ready');
  }
});

test('enqueue failure rolls back its job and pointer atomically', () => {
  const f = fixture(); pipeline.startChangePipeline(f.change.id, {}, f.user);
  let id = '';
  pipeline.advanceChangePipelines({ enqueue(input: any) {
    id = store.put('jobs', { ...input, status: 'queued' }).id;
    throw Error('simulated dispatch failure');
  } });
  assert.equal(store.get('jobs', id), undefined);
  assert.equal(f.state().currentJobId, null);
  assert.equal(f.state().status, 'blocked');
});

test('start validates access and settings and caps auto jobs without changing repository policies', () => {
  const f = fixture();
  const viewer = store.put('users', { role: 'viewer', projects: [f.repo.projectId] });
  assert.throws(() => pipeline.startChangePipeline(f.change.id, {}, viewer), /access denied/);
  assert.throws(() => pipeline.startChangePipeline(f.change.id, { thinkingLevel: 'unbounded' }, f.user));
  assert.throws(() => pipeline.startChangePipeline(f.change.id, { maxRepairCycles: 100 }, f.user));
  const auto = fixture('auto');
  auto.start({ autonomy: 'auto' });
  assert.equal(auto.job().autonomy, 'prepare');
  assert.equal(store.get('repos', auto.repo.id)!.autonomy, 'auto');
  pipeline.stopChangePipeline(auto.change.id, auto.user, auto.dependencies);
  f.start(); assert.throws(() => f.start(), /already exists/);
  store.put('users', { id: f.user.id, disabled: true });
  f.tick(); assert.equal(f.state().status, 'paused');
});

test('real enqueue keeps repository approval gates without running agents', async () => {
  const f = fixture('approve');
  pipeline.startChangePipeline(f.change.id, { autonomy: 'auto' }, f.user);
  // Isolate implementation dispatch: actual enqueue must cap prepare to the
  // repository's approve policy, independently of the injectable test queue.
  store.put('changePipelines', { id: f.change.id, stage: 'implement' });
  const { enqueue } = await import('../src/server/jobs.js');
  pipeline.advanceChangePipelines({ enqueue });
  assert.equal(f.job().status, 'awaiting_approval');
  assert.equal(f.job().autonomy, 'approve');
  assert.equal(f.job().sourceBranch, f.change.source);
  assert.equal(store.get('repos', f.repo.id)!.autonomy, 'approve');
  pipeline.stopChangePipeline(f.change.id, f.user, f.dependencies);
});

test('routes expose persistent pipeline, enforce write access, and stop cancels without further dispatch', async () => {
  const f = fixture();
  const app = Fastify();
  app.setErrorHandler((error: any, _req, reply) => reply.code(400).send({ error: error.message }));
  app.addHook('preHandler', async (req: any) => { req.user = req.headers['x-viewer'] ? { ...f.user, role: 'viewer' } : f.user; });
  pipeline.registerChangePipelineRoutes(app, f.dependencies);
  try {
    const url = `/api/changes/${f.change.id}/pipeline`;
    assert.equal((await app.inject({ method: 'POST', url, payload: {}, headers: { 'x-viewer': 'yes' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url, payload: { model: 'test' } })).statusCode, 200);
    f.tick();
    const id = f.job().id;
    const read = await app.inject({ method: 'GET', url, headers: { 'x-viewer': 'yes' } });
    assert.equal(read.json().pipeline.currentJobId, id);
    const stopped = await app.inject({ method: 'POST', url: `${url}/stop` });
    assert.equal(stopped.json().status, 'stopped');
    assert.equal(store.get('jobs', id)!.status, 'cancelled');
    f.tick(); assert.equal(f.calls.length, 1);
    assert.equal((await app.inject({ method: 'POST', url: `${url}/stop` })).json().status, 'stopped');
  } finally { await app.close(); }
});
