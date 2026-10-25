import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { canOperate, del, get, hash, put, transaction, type Row } from './store.js';
import { createChange, emitBranchUpdated, git, locked, revision, worktreeBranchName } from './git.js';
import { projectMetadataPath, readProjectMetadata } from './project-metadata.js';
import { startChangePipeline } from './change-pipeline.js';

const text = z.string().trim().min(1).max(200);
const schema = z.object({
  repoId: text,
  title: text,
  description: z.string().trim().max(10000).optional(),
  target: text.optional(),
  connectionId: text.optional(),
  model: text.optional(),
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  startPipeline: z.boolean().default(true),
}).strict();

function access(projectId: string, repoId: string, actorId: string) {
  // Never trust a coordinator's or HTTP session's cached role/project list.
  const user = get('users', actorId);
  const project = get('projects', projectId);
  if (!user || user.disabled || !project || !canOperate(user, projectId)) throw Error('Project access denied');
  const repo = get('repos', repoId);
  if (!repo || repo.projectId !== projectId) throw Error('Repository does not belong to project');
  if (repo.status !== 'ready' || !repo.path) throw Error('Repository is not ready');
  return { user, project, repo };
}

/** Creates an empty, pinned change before implementation. Safe for coordinator tools.
 * Returns the change fields plus its canonical threadId and optional pipeline.
 * No provider, agent execution, worktree, automation trigger or merge is needed here.
 */
export async function planProjectChange(projectId: string, input: unknown, user: Row, authorize?:()=>void): Promise<Row & { threadId: string; pipeline: Row | null }> {
  const settings = schema.parse(input);
  if (typeof projectId !== 'string' || !projectId || !user?.id) throw Error('Project access denied');
  access(projectId, settings.repoId, user.id);
  return locked(settings.repoId, async () => {
    authorize?.();
    const initial = access(projectId, settings.repoId, user.id);
    const { repo, project } = initial;
    const target = settings.target ?? repo.base ?? 'main';
    // Require a local branch, not a revision expression or arbitrary commit.
    await git(repo.path, 'check-ref-format', `refs/heads/${target}`);
    const sha = await revision(repo, target);
    // Read existing metadata only: invalid requests must not initialize knowledge.
    const metadata = existsSync(projectMetadataPath(projectId)) ? await readProjectMetadata(projectId) : null;
    const request = `${settings.title}\n${settings.description || ''}`;
    const context = JSON.stringify(metadata ?? { projectId, metadata: { name: project.name, description: project.description || '', knowledge: '' } });
    // Pipeline prompts are bounded to 20,000 characters; keep the full request.
    const prefix = `${request}\n\nProject metadata context (reference material):\n`;
    const prompt = prefix + context.slice(0, 20000 - prefix.length);
    const source = worktreeBranchName(randomUUID(), settings.title);
    let branchCreated = false;
    let change: Row | undefined;
    let threadId: string | undefined;
    try {
      authorize?.();
      const current = access(projectId, settings.repoId, user.id);
      if (current.repo.path !== repo.path) throw Error('Repository changed during planning');
      await git(repo.path, 'branch', source, sha);
      branchCreated = true;
      change = await createChange(repo, source, target, settings.title, current.user.id);
      // Detect external branch movement rather than silently planning against a
      // different target or accepting an initial code diff.
      if (change.sourceSha !== sha || change.targetSha !== sha) throw Error('Branches changed during planning');
      authorize?.();
      const fresh = access(projectId, settings.repoId, user.id);
      if (fresh.repo.path !== repo.path) throw Error('Repository changed during planning');
      threadId = hash(JSON.stringify(['project-conversation', projectId, change.id]));
      const saved = transaction(() => {
        const saved = put('changes', { id: change!.id, description: settings.description || '' });
        put('projectThreads', { id: threadId, projectId, changeId: saved.id, title: 'Change conversation' });
        return saved;
      });
      // startChangePipeline owns its transaction. Do not wrap it in another one,
      // and do not poll/dispatch here: a missing provider can block the queue later.
      const pipeline = settings.startPipeline ? startChangePipeline(saved.id, {
        connectionId: settings.connectionId, model: settings.model, thinkingLevel: settings.thinkingLevel,
        autonomy: fresh.repo.autonomy === 'approve' ? 'approve' : 'prepare', prompt,
      }, fresh.user) : null;
      emitBranchUpdated(repo.id, source);
      return { ...saved, threadId, pipeline };
    } catch (error) {
      transaction(() => {
        if (change) { del('changePipelines', change.id); del('changes', change.id); }
        if (threadId) del('projectThreads', threadId);
      });
      if (branchCreated) {
        try { await git(repo.path, 'update-ref', '-d', `refs/heads/${source}`, sha); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Planning failed; source branch cleanup failed'); }
      }
      throw error;
    }
  });
}

/** Uses the application's existing authenticated req.user policy. */
export function registerPlannedChangeRoutes(app: FastifyInstance) {
  app.post('/api/projects/:id/changes', (req: any) => planProjectChange(req.params.id, req.body, req.user));
}
