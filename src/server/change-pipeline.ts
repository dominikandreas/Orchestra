import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { enqueue, signalJob } from './jobs.js';
import { all, get, put, hash, transaction, canOperate, canProject, type Row } from './store.js';

export type PipelineStage = 'design' | 'research' | 'implement' | 'review' | 'test' | 'address';
// Dispatch must be synchronous and persist to the same store: enqueue and the pointer
// commit together. Agents are executed only by the existing jobs queue, never here.
export type PipelineDependencies = {
  enqueue?: typeof enqueue;
  cancel?: (id: string) => void;
};
const settingsSchema = z.object({
  connectionId: z.string().min(1).max(200).nullable().optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  autonomy: z.enum(['approve', 'prepare', 'auto']).optional(),
  prompt: z.string().trim().max(20000).optional(),
}).strict();
const activeStatuses = ['queued', 'running', 'awaiting_approval'];
const instructions: Record<PipelineStage, string> = {
  design: 'Design the requested change. Output a design artifact with goals, constraints, alternatives, acceptance criteria and risks. Read only: do not edit files, commit code or implement anything.',
  research: 'Research the design against the repository. Output an artifact with relevant files, existing patterns, feasibility, dependencies and a concrete implementation and test plan. Read only: do not edit files, commit code or implement anything.',
  implement: 'Implement the design and research plan on the existing change source branch. Do not merge. Include evidence and remaining risks.',
  review: 'Independently review this exact change for correctness, regressions and test coverage. Record an honest verdict with submit_review; approve only with no unresolved concerns. Do not edit files or merge.',
  test: 'Run the configured repository tests against the candidate merge. Do not merge.',
  address: 'Address the recorded review findings and test failures on the existing change source branch. Do not merge. Explain each fix and remaining risks.',
};

export function getChangePipeline(changeId: string): Row | undefined {
  return get('changePipelines', changeId);
}
function access(changeId: string, user: Row, write = true) {
  const change = get('changes', changeId);
  const repo = change && get('repos', change.repoId);
  if (!change || !repo) throw Error('Change request not found');
  if (!user || user.disabled || !(write ? canOperate(user, repo.projectId) : canProject(user, repo.projectId)))
    throw Error('Project access denied');
  return { change, repo };
}
function pause(p: Row, reason: string, status = 'paused') {
  return put('changePipelines', { id: p.id, status, reason });
}
// Jobs are capped at prepare; maybeAutoMerge also excludes changes with a
// persisted changePipelines record, including after the pipeline reaches ready.
export function startChangePipeline(changeId: string, input: unknown, user: Row) {
  const settings = settingsSchema.parse(input ?? {});
  return transaction(() => {
    const { change, repo } = access(changeId, user);
    if (change.status !== 'open') throw Error('Change request is closed');
    if (change.conflict === true) throw Error('Resolve the actual merge conflict before starting a pipeline');
    const old = getChangePipeline(changeId);
    if (old && !['stopped', 'ready'].includes(old.status)) throw Error('A pipeline already exists; stop it before restarting');
    if (old?.currentJobId && activeStatuses.includes(get('jobs', old.currentJobId)?.status))
      throw Error('The previous pipeline task is still active');
    return put('changePipelines', {
      id: changeId, changeId, repoId: repo.id, projectId: repo.projectId,
      authorId: user.id, runId: randomUUID(), settings,
      status: 'running', stage: 'design', repairCycles: 0, maxRepairCycles: 3,
      currentJobId: null, reason: null, evidence: old?.evidence || [],
      started: new Date().toISOString(), finished: null, reviewPassed: false,
    });
  });
}
export function stopChangePipeline(changeId: string, user: Row, dependencies: PipelineDependencies = {}) {
  return transaction(() => {
    access(changeId, user);
    const p = getChangePipeline(changeId);
    if (!p) throw Error('Pipeline not found');
    if (p.status === 'stopped') return p;
    const stopped = put('changePipelines', { id: p.id, status: 'stopped', reason: 'Stopped by user', finished: new Date().toISOString() });
    const job = p.currentJobId && get('jobs', p.currentJobId);
    if (job && activeStatuses.includes(job.status)) {
      if (dependencies.cancel) dependencies.cancel(job.id);
      else signalJob(job.id, 'cancel');
    }
    return stopped;
  });
}
function dispatch(p: Row, change: Row, user: Row, dependencies: PipelineDependencies) {
  const stage = p.stage as PipelineStage;
  const readOnly = stage === 'design' || stage === 'research';
  const context = p.evidence.filter((e: any) => e.runId === p.runId);
  const job = (dependencies.enqueue || enqueue)({
    repoId: p.repoId, changeId: readOnly ? undefined : change.id,
    kind: readOnly ? 'review' : stage,
    title: `${stage}: ${change.title}`,
    // Even read-only planning starts from the existing source, not repo.base.
    sourceBranch: change.source, targetBranch: readOnly ? change.source : change.target,
    connectionId: p.settings.connectionId || undefined, model: p.settings.model || undefined,
    thinkingLevel: p.settings.thinkingLevel,
    autonomy: p.settings.autonomy === 'approve' ? 'approve' : 'prepare',
    tools: ['workspace'], mcpServers: [],
    prompt: `${instructions[stage]}\nChange: ${change.title}\nSource: ${change.source} (${change.sourceSha}); target: ${change.target} (${change.targetSha}).\nRequest: ${p.settings.prompt || change.description || ''}\nPrior stage artifacts and evidence:\n${JSON.stringify(context)}`,
  }, user);
  const threadId=hash(JSON.stringify(['project-conversation',p.projectId,change.id]));
  if(!get('projectThreads',threadId))put('projectThreads',{id:threadId,projectId:p.projectId,changeId:change.id,title:'Change conversation'});
  put('jobs', { id: job.id, projectThreadId:threadId,parentProjectThreadId:p.parentProjectThreadId||threadId,parentRunId:p.parentRunId, pipelineId: p.id, pipelineRunId: p.runId, pipelineStage: stage, pipelineRepairCycle: p.repairCycles });
  return put('changePipelines', { id: p.id, currentJobId: job.id, reason: null });
}
function currentEvidence(kind: string, job: Row, change: Row) {
  return all(kind).filter(e => e.jobId === job.id && e.changeId === change.id &&
    e.sourceSha === change.sourceSha && e.targetSha === change.targetSha);
}
function step(id: string, dependencies: PipelineDependencies) {
  let p = getChangePipeline(id)!;
  if (p.status === 'ready') {
    const change = get('changes', p.changeId);
    if (!change || change.sourceSha !== p.reviewSourceSha || change.targetSha !== p.reviewTargetSha)
      return pause(p, 'Change revisions changed after pipeline validation');
    return;
  }
  if (p.status !== 'running') return;
  const user = get('users', p.authorId);
  const change = get('changes', p.changeId);
  const repo = get('repos', p.repoId);
  if (!user || user.disabled || !repo || !canOperate(user, repo.projectId)) return pause(p, 'Job owner access was revoked');
  if (!change || change.status !== 'open') return pause(p, 'Change request is closed or missing');
  if (change.conflict === true) return pause(p, 'Actual merge conflict requires human resolution');
  if (!p.currentJobId) return dispatch(p, change, user, dependencies);
  const job = get('jobs', p.currentJobId);
  if (!job) return pause(p, 'Current job is missing');
  if (activeStatuses.includes(job.status)) return;
  const reviews = currentEvidence('reviews', job, change);
  const checks = currentEvidence('checks', job, change);
  const evidence = {
    runId: p.runId, stage: p.stage, cycle: p.repairCycles, jobId: job.id,
    status: job.status, result: job.result, error: job.error,
    sourceSha: job.sourceSha, targetSha: job.targetSha,
    reviews: reviews.map(r => ({ id: r.id, verdict: r.verdict, body: r.body })),
    checks: checks.map(c => ({ id: c.id, status: c.status, log: c.log, exitCode: c.exitCode })),
  };
  // Record a terminal task once, even when subsequent polls remain paused.
  p = put('changePipelines', { id: p.id, evidence: [...p.evidence, evidence] });
  if (['blocked', 'cancelled', 'interrupted'].includes(job.status)) return pause(p, `Task ${job.status}: ${job.error || job.id}`);
  if (job.status !== 'completed' && !(p.stage === 'test' && job.status === 'failed'))
    return pause(p, `Task did not complete: ${job.status}`);
  let next: PipelineStage;
  switch (p.stage as PipelineStage) {
    case 'design':
    case 'research':
      if (!String(job.result || '').trim()) return pause(p, 'Planning artifact is missing');
      next = p.stage === 'design' ? 'research' : 'implement';
      break;
    case 'implement': case 'address': next = 'review'; break;
    case 'review':
      if (!reviews.length) return pause(p, 'Review evidence is missing or stale');
      p = put('changePipelines', { id: p.id,
        reviewPassed: reviews.every(r => r.verdict === 'approved'),
        reviewSourceSha: change.sourceSha, reviewTargetSha: change.targetSha });
      next = 'test';
      break;
    case 'test': {
      if (!repo.testCommand || checks.some(c => c.status === 'not_run')) return pause(p, 'Tests are not configured or were not run', 'blocked');
      if (!checks.length) return pause(p, 'Test evidence is missing or stale');
      if (p.reviewSourceSha !== change.sourceSha || p.reviewTargetSha !== change.targetSha)
        return pause(p, 'Change revisions changed after review');
      if (p.reviewPassed && job.status === 'completed' && checks.every(c => c.status === 'passed'))
        return put('changePipelines', { id: p.id, status: 'ready', reason: null, currentJobId: null, finished: new Date().toISOString() });
      if (!checks.every(c => ['passed', 'failed'].includes(c.status))) return pause(p, 'Tests did not finish', 'blocked');
      if (p.repairCycles >= 3) return pause(p, 'Maximum of 3 repair cycles exhausted', 'blocked');
      p = put('changePipelines', { id: p.id, repairCycles: p.repairCycles + 1, reviewPassed: false });
      next = 'address';
      break;
    }
  }
  p = put('changePipelines', { id: p.id, stage: next!, currentJobId: null });
  return dispatch(p, change, user, dependencies);
}

/** Schedule from the server queue poll. Safe to call repeatedly or after restart. */
export function advanceChangePipelines(dependencies: PipelineDependencies = {}) {
  for (const p of all('changePipelines').filter(p => ['running','ready'].includes(p.status))) {
    try {
      transaction(() => step(p.id, dependencies));
    } catch (error) {
      // A failed enqueue rolls back both job and pointer. Keep the reason visible
      // rather than retrying a non-transient failure in an unbounded loop.
      transaction(() => {
        const current = getChangePipeline(p.id);
        if (current?.status === 'running') pause(current, String(error), 'blocked');
      });
    }
  }
}

/** Uses the application's authenticated req.user; does not install a second auth policy. */
export function registerChangePipelineRoutes(app: FastifyInstance, dependencies: PipelineDependencies = {}) {
  app.post('/api/changes/:id/pipeline', (req: any) => startChangePipeline(req.params.id, req.body, req.user));
  app.get('/api/changes/:id/pipeline', (req: any) => {
    access(req.params.id, req.user, false);
    return { pipeline: getChangePipeline(req.params.id) || null };
  });
  app.post('/api/changes/:id/pipeline/stop', (req: any) => stopChangePipeline(req.params.id, req.user, dependencies));
}
