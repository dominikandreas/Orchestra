import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import httpProxy from 'http-proxy';
import { all, get, put, del, token, hash, type Row } from './store.js';
import { command, createWorktree, revision, locked, branches, git, onBranchUpdated } from './git.js';

export type DeploymentOptions = {
  branch?: string;
  lifetimeMinutes?: number;
  customName?: string;
};

function putDeployment(record: { id: string } & Partial<Row>) {
  if (get('deployments', record.id)) {
    return put('deployments', record);
  }
  if (get('previews', record.id)) {
    return put('previews', record);
  }
  return put('deployments', record);
}

export async function startDeployment(
  repo: Row,
  job: Row | undefined,
  userId: string,
  branchOrOpts?: string | DeploymentOptions
) {
  if (!repo.previewCommand) throw Error('Set a deployment/preview command in repository settings first.');
  let branch: string | undefined;
  let lifetimeMinutes = 30;
  let customName: string | undefined;

  if (typeof branchOrOpts === 'string') {
    branch = branchOrOpts;
  } else if (branchOrOpts) {
    branch = branchOrOpts.branch;
    if (branchOrOpts.lifetimeMinutes !== undefined) lifetimeMinutes = branchOrOpts.lifetimeMinutes;
    customName = branchOrOpts.customName;
  }

  let targetBranch = branch || (job?.sourceBranch && job.sourceBranch !== 'auto' ? job.sourceBranch : undefined) || repo.base || 'main';
  let targetSha: string | undefined;
  try {
    targetSha = await revision(repo, targetBranch);
  } catch {
    const allB: string[] = await branches(repo).catch(() => []);
    if (allB.length > 0) {
      targetBranch = allB.includes(targetBranch) ? targetBranch : (allB.includes(repo.base) ? repo.base : allB[0]);
      targetSha = await revision(repo, targetBranch).catch(() => undefined);
    }
  }
  if (!targetSha) throw Error(`Branch "${targetBranch}" not found in repository`);

  const p = put('deployments', {
    repoId: repo.id,
    projectId: repo.projectId,
    jobId: job?.id,
    branch: targetBranch,
    sha: targetSha,
    userId,
    status: 'starting',
    lifetimeMinutes,
    customName,
    lastUsed: Date.now()
  });
  const name = `relay-deploy-${p.id}`;
  try {
    const path = job?.path || await locked(repo.id, () => createWorktree(repo, `deploy-${p.id}`, targetBranch));
    await command('docker', [
      'run', '-d',
      '--name', name,
      '--label', 'relay.managed=true',
      '--label', `relay.deployment=${p.id}`,
      '--label', `relay.repo=${repo.id}`,
      '--label', `relay.branch=${targetBranch}`,
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=256',
      '--memory=2g',
      '--cpus=2',
      '--user', `${process.getuid?.() || 1000}:${process.getgid?.() || 1000}`,
      '-p', `127.0.0.1::${repo.port}`,
      '--mount', `type=bind,source=${path},target=/workspace`,
      '--mount', `type=bind,source=${path}/.git,target=/workspace/.git,readonly`,
      '-w', '/workspace',
      '-e', 'HOME=/tmp',
      repo.image,
      'bash', '-lc', repo.previewCommand
    ], undefined, 180000);

    const port = Number((await command('docker', ['port', name, `${repo.port}/tcp`])).split(':').at(-1));
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
        ready = r.status < 500;
        if (ready) break;
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!ready) throw Error('Deployment did not become ready within 60 seconds. Check container logs.');
    return put('deployments', { id: p.id, status: 'running', port, name, path, branch: targetBranch, sha: targetSha, error: null });
  } catch (e) {
    put('deployments', { id: p.id, status: 'failed', name, error: String(e) });
    throw e;
  }
}
export const startPreview = startDeployment;

export async function updateDeployment(deploymentId: string, newSha?: string) {
  const d = get('deployments', deploymentId) || get('previews', deploymentId);
  if (!d || !d.path || !d.branch) return;
  if (['stopped'].includes(d.status)) return;
  const repo = get('repos', d.repoId);
  if (!repo) return;

  const currentSha = newSha || await revision(repo, d.branch).catch(() => undefined);
  if (!currentSha || currentSha === d.sha) return;

  putDeployment({ id: d.id, status: 'starting', sha: currentSha, error: null });
  try {
    await locked(repo.id, async () => {
      let wtPath = d.path;
      if (!existsSync(wtPath)) {
        wtPath = await createWorktree(repo, `deploy-${d.id}`, d.branch);
        putDeployment({ id: d.id, path: wtPath });
      }
      await git(wtPath, 'reset', '--hard', currentSha);
      await git(wtPath, 'clean', '-fd');
    });

    if (d.name) {
      await command('docker', ['rm', '-f', d.name]).catch(() => {});
    }
    const name = d.name || `relay-deploy-${d.id}`;
    await command('docker', [
      'run', '-d',
      '--name', name,
      '--label', 'relay.managed=true',
      '--label', `relay.deployment=${d.id}`,
      '--label', `relay.repo=${repo.id}`,
      '--label', `relay.branch=${d.branch}`,
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=256',
      '--memory=2g',
      '--cpus=2',
      '--user', `${process.getuid?.() || 1000}:${process.getgid?.() || 1000}`,
      '-p', `127.0.0.1::${repo.port}`,
      '--mount', `type=bind,source=${d.path},target=/workspace`,
      '--mount', `type=bind,source=${d.path}/.git,target=/workspace/.git,readonly`,
      '-w', '/workspace',
      '-e', 'HOME=/tmp',
      repo.image,
      'bash', '-lc', repo.previewCommand
    ], undefined, 180000);

    const port = Number((await command('docker', ['port', name, `${repo.port}/tcp`])).split(':').at(-1));
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
        ready = r.status < 500;
        if (ready) break;
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!ready) throw Error('Deployment did not become ready within 60 seconds after branch update.');
    return putDeployment({ id: d.id, status: 'running', port, name, path: d.path, branch: d.branch, sha: currentSha, error: null, lastUsed: Date.now() });
  } catch (e) {
    putDeployment({ id: d.id, status: 'failed', error: String(e) });
  }
}

export function notifyBranchUpdated(repoId: string, branchName: string) {
  const repo = get('repos', repoId);
  const matching = all('deployments').concat(all('previews')).filter(d =>
    d.repoId === repoId &&
    (d.branch === branchName || (!d.branch && branchName === repo?.base)) &&
    ['running', 'starting'].includes(d.status)
  );
  for (const d of matching) {
    void updateDeployment(d.id).catch(() => {});
  }
}
onBranchUpdated(notifyBranchUpdated);

export async function syncDeployments() {
  const active = all('deployments').concat(all('previews')).filter(d => d.status === 'running' && d.branch);
  for (const d of active) {
    const repo = get('repos', d.repoId);
    if (!repo) continue;
    try {
      const currentSha = await revision(repo, d.branch);
      if (currentSha && d.sha && currentSha !== d.sha) {
        void updateDeployment(d.id, currentSha).catch(() => {});
      }
    } catch {}
  }
}

export async function stopDeployment(id: string) {
  const p = get('deployments', id) || get('previews', id);
  if (p?.name) await command('docker', ['rm', '-f', p.name]).catch(() => {});
  return putDeployment({ id, status: 'stopped' });
}
export const stopPreview = stopDeployment;

export async function restartDeployment(id: string) {
  const p = get('deployments', id) || get('previews', id);
  if (!p) throw Error('Deployment not found');
  const repo = get('repos', p.repoId);
  if (!repo) throw Error('Repository not found');
  if (p.name) await command('docker', ['rm', '-f', p.name]).catch(() => {});
  return startDeployment(repo, p.jobId ? get('jobs', p.jobId) : undefined, p.userId, {
    branch: p.branch,
    lifetimeMinutes: p.lifetimeMinutes,
    customName: p.customName
  });
}

export async function configureDeployment(id: string, config: { branch?: string; lifetimeMinutes?: number; customName?: string }) {
  const d = get('deployments', id) || get('previews', id);
  if (!d) throw Error('Deployment not found');
  const repo = get('repos', d.repoId);
  if (!repo) throw Error('Repository not found');

  const patch: { id: string } & Record<string, any> = { id: d.id };
  if (config.lifetimeMinutes !== undefined) {
    patch.lifetimeMinutes = config.lifetimeMinutes;
  }
  if (config.customName !== undefined) {
    patch.customName = config.customName.trim() || null;
  }

  let branchChanged = false;
  if (config.branch && config.branch !== d.branch) {
    const targetSha = await revision(repo, config.branch).catch(() => undefined);
    if (!targetSha) throw Error(`Branch "${config.branch}" not found in repository`);
    patch.branch = config.branch;
    patch.sha = targetSha;
    branchChanged = true;
  }

  putDeployment(patch);

  if (branchChanged && d.status === 'running') {
    void updateDeployment(d.id, patch.sha).catch(() => {});
  }

  return get('deployments', id) || get('previews', id);
}

export async function removeDeployment(id: string) {
  const p = get('deployments', id) || get('previews', id);
  if (!p) return { ok: true };
  if (p.name) {
    await command('docker', ['rm', '-f', p.name]).catch(() => {});
  }
  const repo = get('repos', p.repoId);
  if (repo && p.path && existsSync(p.path)) {
    await rm(p.path, { recursive: true, force: true }).catch(() => {});
    await git(repo.path, 'worktree', 'prune').catch(() => {});
    await git(repo.path, 'branch', '-D', `relay/deploy-${p.id}`).catch(() => {});
  }
  del('deployments', id);
  del('previews', id);
  for (const g of all('previewGrants').filter(g => g.deploymentId === id || g.previewId === id)) {
    del('previewGrants', g.id);
  }
  return { ok: true, id };
}

export async function cleanupStoppedDeployments(projectId?: string) {
  const allList = all('deployments').concat(all('previews'));
  const target = allList.filter(d =>
    (!projectId || projectId === 'all' || d.projectId === projectId) &&
    ['stopped', 'failed'].includes(d.status)
  );
  let count = 0;
  for (const d of target) {
    await removeDeployment(d.id).catch(() => {});
    count++;
  }
  return { ok: true, count, removed: count };
}

export function deploymentLink(p: Row, userId: string, baseUrlOrHost: string, prefix = 'deployment') {
  const raw = token();
  put('previewGrants', { hash: hash(raw), previewId: p.id, deploymentId: p.id, userId, expires: Date.now() + 10 * 60000 });
  if (process.env.RELAY_PREVIEW_URL) return `${process.env.RELAY_PREVIEW_URL}/open#${raw}`;
  const root = baseUrlOrHost.startsWith('http://') || baseUrlOrHost.startsWith('https://')
    ? baseUrlOrHost
    : `${process.env.RELAY_TLS_CERT ? 'https' : 'http'}://${baseUrlOrHost}`;
  return `${root.replace(/\/+$/, '')}/${prefix}/${p.id}/open#${raw}`;
}
export function previewLink(p: Row, userId: string, baseUrlOrHost: string) {
  return deploymentLink(p, userId, baseUrlOrHost, 'preview');
}

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  const map: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) map[k] = v.join('=');
  }
  return map;
}

function stripOrchestraCookies(header?: string): string | undefined {
  if (!header) return undefined;
  const kept = header.split(';').map(c => c.trim()).filter(c => !c.startsWith('relay_') && !c.startsWith('orchestra_'));
  return kept.length ? kept.join('; ') : undefined;
}

export function authorizeDeployment(req: http.IncomingMessage, deploymentId: string): Row | null {
  const p = get('deployments', deploymentId) || get('previews', deploymentId);
  if (!p || p.status !== 'running') return null;
  const cookies = parseCookies(req.headers.cookie);
  const secret = cookies[`relay_deployment_${deploymentId}`] || cookies[`relay_preview_${deploymentId}`] || cookies['relay_preview'];
  if (secret) {
    const g = all('previewGrants').find(g =>
      (g.deploymentId === deploymentId || g.previewId === deploymentId) &&
      g.hash === hash(secret) &&
      g.expires > Date.now()
    );
    const u = g && get('users', g.userId);
    if (u && !u.disabled && (['owner', 'admin'].includes(u.role) || (u.projects || []).includes(p.projectId))) {
      putDeployment({ id: p.id, lastUsed: Date.now() });
      return p;
    }
  }
  const rawAuth = req.headers.authorization?.replace(/^Bearer /, '');
  if (rawAuth) {
    const d = all('devices').find(d => d.hash === hash(rawAuth));
    const u = d && get('users', d.userId);
    if (u && !u.disabled && (['owner', 'admin'].includes(u.role) || (u.projects || []).includes(p.projectId))) {
      putDeployment({ id: p.id, lastUsed: Date.now() });
      return p;
    }
  }
  return null;
}
export const authorizePreview = authorizeDeployment;

export function claimGrantToken(deploymentId: string, rawToken: string, isSecure = false): string[] | null {
  const g = all('previewGrants').find(g =>
    (g.deploymentId === deploymentId || g.previewId === deploymentId) &&
    g.hash === hash(rawToken) &&
    g.expires > Date.now() &&
    !g.claimed
  );
  if (!g) return null;
  const secret = token();
  put('previewGrants', { ...g, hash: hash(secret), claimed: true, expires: Date.now() + 8 * 3600000 });
  const sec = isSecure ? '; Secure' : '';
  return [
    `relay_deployment_${deploymentId}=${secret}; Path=/; HttpOnly; SameSite=Lax${sec}`,
    `relay_preview_${deploymentId}=${secret}; Path=/; HttpOnly; SameSite=Lax${sec}`,
    `relay_active_deployment=${deploymentId}; Path=/; SameSite=Lax${sec}`,
    `relay_active_preview=${deploymentId}; Path=/; SameSite=Lax${sec}`
  ];
}

function renderOpenPage(deploymentId: string, kind = 'deployment'): string {
  const labelName = kind === 'preview' ? 'preview' : 'deployment';
  const capLabel = kind === 'preview' ? 'Preview' : 'Deployment';
  return `<!doctype html>
<html>
<head>
 <meta charset="utf-8">
 <meta name="viewport" content="width=device-width, initial-scale=1">
 <title>Opening ${labelName} · Orchestra</title>
 <style>
  body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f141c; color: #f0f6fc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px; max-width: 400px; text-align: center; }
  h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
  p { font-size: 14px; color: #8b949e; margin: 0; line-height: 1.5; }
  .spinner { width: 24px; height: 24px; border: 3px solid #30363d; border-top-color: #58a6ff; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
 </style>
</head>
<body>
 <div class="card">
  <div class="spinner" id="sp"></div>
  <h1>Opening ${labelName}</h1>
  <p id="msg">Connecting to your ${labelName} container…</p>
 </div>
 <script>
  const t = location.hash.slice(1);
  if (!t) {
   document.getElementById('sp').style.display = 'none';
   document.getElementById('msg').textContent = 'Missing ${labelName} token. Open a fresh link from the Orchestra dashboard.';
  } else {
   fetch('/${kind}/${deploymentId}/claim', { method: 'POST', body: t }).then(r => {
    if (r.ok) location.replace('/${kind}/${deploymentId}/');
    else {
     document.getElementById('sp').style.display = 'none';
     document.getElementById('msg').textContent = '${capLabel} link expired or unauthorized. Open a fresh link from Orchestra.';
    }
   }).catch(() => {
    document.getElementById('sp').style.display = 'none';
    document.getElementById('msg').textContent = 'Could not reach Orchestra server.';
   });
  }
 </script>
</body>
</html>`;
}

export function registerDeploymentIngress(app: any) {
  const proxy = httpProxy.createProxyServer({ ws: true });
  proxy.on('error', (_err, _req, res: any) => {
    if (res && res.writeHead && !res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Deployment is not available');
    } else if (res && res.destroy) {
      res.destroy();
    }
  });

  app.addHook('onRequest', async (req: any, reply: any) => {
    const rawReq: http.IncomingMessage = req.raw;
    const rawRes: http.ServerResponse = reply.raw;
    const url = req.url || rawReq.url || '/';
    const isSecure = Boolean(process.env.RELAY_TLS_CERT || req.headers['x-forwarded-proto'] === 'https');

    const match = url.match(/^\/(?:deployment|preview)\/([^/?#]+)(?:([/?#].*)|$)/);
    if (match) {
      const deploymentId = match[1];
      const rest = match[2] || '';
      const prefix = url.startsWith('/deployment') ? '/deployment' : '/preview';

      if (rest === '/open' || rest.startsWith('/open?')) {
        reply.hijack();
        rawRes.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'same-origin' });
        rawRes.end(renderOpenPage(deploymentId, prefix === '/preview' ? 'preview' : 'deployment'));
        return;
      }

      if (rest === '/claim' && req.method === 'POST') {
        reply.hijack();
        let body = '';
        for await (const chunk of rawReq) {
          body += chunk;
          if (body.length > 512) {
            rawRes.writeHead(400);
            rawRes.end();
            return;
          }
        }
        const cookies = claimGrantToken(deploymentId, body.trim(), isSecure);
        if (!cookies) {
          rawRes.writeHead(401, { 'Content-Type': 'text/plain' });
          rawRes.end('Unauthorized or expired');
          return;
        }
        rawRes.setHeader('Set-Cookie', cookies);
        rawRes.writeHead(200, { 'Content-Type': 'text/plain' });
        rawRes.end('ok');
        return;
      }

      const qIdx = url.indexOf('?');
      if (qIdx !== -1) {
        const params = new URLSearchParams(url.slice(qIdx + 1));
        const directToken = params.get('token') || params.get('grant');
        if (directToken) {
          const cookies = claimGrantToken(deploymentId, directToken, isSecure);
          if (cookies) {
            params.delete('token');
            params.delete('grant');
            const rem = params.toString();
            const clean = `${prefix}/${deploymentId}/${rem ? `?${rem}` : ''}`;
            reply.hijack();
            rawRes.setHeader('Set-Cookie', cookies);
            rawRes.writeHead(302, { Location: clean });
            rawRes.end();
            return;
          }
        }
      }

      if (!rest) {
        reply.hijack();
        rawRes.writeHead(302, { Location: `${prefix}/${deploymentId}/` });
        rawRes.end();
        return;
      }

      const p = authorizeDeployment(rawReq, deploymentId);
      if (!p) {
        reply.hijack();
        rawRes.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        rawRes.end('<title>Unauthorized</title><p style="font-family:sans-serif;padding:24px;color:#c9d1d9;background:#0d1117">Access denied. Open this deployment from the Orchestra dashboard.</p>');
        return;
      }

      reply.hijack();
      let targetPath = rest.startsWith('/') ? rest : `/${rest}`;
      if (targetPath.startsWith('?')) targetPath = '/' + targetPath;
      if (!targetPath) targetPath = '/';
      rawReq.url = targetPath;
      delete rawReq.headers.authorization;
      const cleanCookies = stripOrchestraCookies(rawReq.headers.cookie);
      if (cleanCookies) rawReq.headers.cookie = cleanCookies;
      else delete rawReq.headers.cookie;
      rawReq.headers['x-forwarded-host'] = rawReq.headers.host;
      rawReq.headers['x-forwarded-proto'] = isSecure ? 'https' : 'http';
      rawReq.headers['x-forwarded-prefix'] = `${prefix}/${deploymentId}`;
      proxy.web(rawReq, rawRes, { target: `http://127.0.0.1:${p.port}` });
      return;
    }

    if (!url.startsWith('/api/')) {
      const referer = rawReq.headers.referer || '';
      const refMatch = referer.match(/\/(?:deployment|preview)\/([^/?#]+)/);
      if (refMatch) {
        const deploymentId = refMatch[1];
        const isOrchestraDashboardPage = ['/', '/overview', '/repositories', '/changes', '/work', '/automations', '/deployments', '/previews', '/settings', '/onboarding'].some(page => url === page || url.startsWith(page + '?') || url.startsWith(page + '/'));
        if (!isOrchestraDashboardPage) {
          const p = authorizeDeployment(rawReq, deploymentId);
          if (p) {
            reply.hijack();
            delete rawReq.headers.authorization;
            const cleanCookies = stripOrchestraCookies(rawReq.headers.cookie);
            if (cleanCookies) rawReq.headers.cookie = cleanCookies;
            else delete rawReq.headers.cookie;
            rawReq.headers['x-forwarded-host'] = rawReq.headers.host;
            rawReq.headers['x-forwarded-proto'] = isSecure ? 'https' : 'http';
            proxy.web(rawReq, rawRes, { target: `http://127.0.0.1:${p.port}` });
            return;
          }
        }
      }
    }
  });

  if (app.server) {
    app.server.on('upgrade', (req: http.IncomingMessage, socket: any, head: Buffer) => {
      let deploymentId: string | undefined;
      const match = req.url?.match(/^\/(?:deployment|preview)\/([^/?#]+)(?:[/?#]|$)/);
      if (match) {
        deploymentId = match[1];
        const prefix = req.url!.startsWith('/deployment') ? '/deployment' : '/preview';
        req.url = req.url!.slice(`${prefix}/${deploymentId}`.length) || '/';
      } else {
        const referer = req.headers.referer || '';
        const refMatch = referer.match(/\/(?:deployment|preview)\/([^/?#]+)/);
        if (refMatch) deploymentId = refMatch[1];
      }
      if (!deploymentId) {
        socket.destroy();
        return;
      }
      const p = authorizeDeployment(req, deploymentId);
      if (!p) {
        socket.destroy();
        return;
      }
      delete req.headers.authorization;
      const cleanCookies = stripOrchestraCookies(req.headers.cookie);
      if (cleanCookies) req.headers.cookie = cleanCookies;
      else delete req.headers.cookie;
      proxy.ws(req, socket, head, { target: `http://127.0.0.1:${p.port}` });
    });
  }

  app.addHook('onClose', async () => {
    proxy.close();
  });
}
export const registerPreviewIngress = registerDeploymentIngress;

export function serveDeployments(host: string) {
  const proxy = httpProxy.createProxyServer({ ws: true });
  proxy.on('error', (_err, _req, res: any) => {
    if (res.writeHead) {
      res.writeHead(502);
      res.end('Deployment is not available');
    } else res.destroy();
  });

  const authorize = (req: http.IncomingMessage) => {
    const cookies = parseCookies(req.headers.cookie);
    const secret = cookies['relay_deployment'] || cookies['relay_preview'];
    const grant = secret && all('previewGrants').find(g => g.hash === hash(secret) && g.expires > Date.now());
    const id = grant && (grant.deploymentId || grant.previewId);
    const p = id && (get('deployments', id) || get('previews', id));
    const u = grant && get('users', grant.userId);
    if (!p || p.status !== 'running' || !u || u.disabled || !(['owner', 'admin'].includes(u.role) || (u.projects || []).includes(p.projectId))) return;
    putDeployment({ id: p.id, lastUsed: Date.now() });
    return p;
  };

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.url === '/open') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<title>Opening deployment</title><p>Opening your deployment…</p><script>const t=location.hash.slice(1);history.replaceState(null,"","/open");fetch("/claim",{method:"POST",body:t}).then(r=>{if(r.ok)location.replace("/");else document.body.textContent="Deployment link expired. Open a fresh link in Orchestra."})</script>');
      return;
    }
    if (req.url === '/claim' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 256) {
          res.writeHead(400);
          res.end();
          return;
        }
      }
      const g = all('previewGrants').find(g => g.hash === hash(body) && g.expires > Date.now() && !g.claimed);
      if (!g) {
        res.writeHead(401);
        res.end();
        return;
      }
      const secret = token();
      put('previewGrants', { ...g, hash: hash(secret), claimed: true, expires: Date.now() + 8 * 3600000 });
      const sec = process.env.RELAY_TLS_CERT ? '; Secure' : '';
      res.setHeader('Set-Cookie', [
        `relay_deployment=${secret}; HttpOnly; SameSite=Strict; Path=/${sec}`,
        `relay_preview=${secret}; HttpOnly; SameSite=Strict; Path=/${sec}`
      ]);
      res.end('ok');
      return;
    }
    const p = authorize(req);
    if (!p) {
      res.writeHead(401);
      res.end('Open this deployment from Orchestra.');
      return;
    }
    delete req.headers.cookie;
    delete req.headers.authorization;
    proxy.web(req, res, { target: `http://127.0.0.1:${p.port}` });
  };

  const server = process.env.RELAY_TLS_CERT
    ? https.createServer({ cert: readFileSync(process.env.RELAY_TLS_CERT), key: readFileSync(process.env.RELAY_TLS_KEY!) }, handler)
    : http.createServer(handler);

  server.on('upgrade', (req, socket, head) => {
    const p = authorize(req);
    if (!p) {
      socket.destroy();
      return;
    }
    delete req.headers.cookie;
    delete req.headers.authorization;
    proxy.ws(req, socket, head, { target: `http://127.0.0.1:${p.port}` });
  });

  server.listen(Number(process.env.RELAY_PREVIEW_PORT || 4311), host);

  setInterval(() => {
    for (const p of all('deployments').concat(all('previews'))) {
      if (p.status !== 'running') continue;
      const timeout = p.lifetimeMinutes !== undefined ? p.lifetimeMinutes : 30;
      // timeout <= 0 means infinite lifetime / never auto-stop
      if (timeout > 0 && p.lastUsed < Date.now() - timeout * 60000) {
        void stopDeployment(p.id);
      }
    }
  }, 60000).unref();

  return server;
}
export const servePreviews = serveDeployments;

export function migratePreviewsToDeployments() {
  for (const p of all('previews')) {
    const repo = get('repos', p.repoId);
    put('deployments', {
      ...p,
      branch: p.branch || repo?.base || 'main',
      sha: p.sha || undefined
    });
    del('previews', p.id);
  }
}
