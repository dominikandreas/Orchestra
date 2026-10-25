import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Set isolation before importing modules that open SQLite at module initialization.
const dataRoot=await mkdtemp(join(tmpdir(),'orchestra-mcp-data-'));
process.env.RELAY_DATA_DIR=dataRoot;
const s=await import('../src/server/store.js');
const control=await import('../src/server/admin-control.js');
const {createApp}=await import('../src/server/app.js');
const {syncMcpServerTools,connectMcpServers}=await import('../src/server/mcp.js');

let app: any;
let root: string;
let adminUser: any;
let regularUser: any;
let project: any;
let adminDeviceToken: string;

test.before(async () => {
  root = await mkdtemp(join(tmpdir(), 'orchestra-mcp-test-'));
  app = await createApp();
  await app.ready();

  const invite = s.issueInvite(undefined, 'owner');
  const redeemed = s.redeemInvite(invite.token, 'Admin Tester');
  adminUser = redeemed.user;
  adminDeviceToken = redeemed.token;

  project = s.put('projects', { name: 'MCP Project' });

  const regularInvite = s.issueInvite(undefined, 'developer', [project.id]);
  const regularRedeemed = s.redeemInvite(regularInvite.token, 'Dev Tester');
  regularUser = regularRedeemed.user;
});

test.after(async () => {
  await app?.close();
  s.db.close();
  await rm(root, { recursive: true, force: true }).catch(() => {});
  await rm(dataRoot,{recursive:true,force:true});
});

test('MCP server CRUD and tool synchronization', async () => {
  // Create a mock stdio MCP server script that responds to MCP JSON-RPC
  const scriptPath = join(root, 'mock-mcp-server.mjs');
  await writeFile(
    scriptPath,
    `#!/usr/bin/env node
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-tools-server', version: '1.0.0' }
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    } else if (msg.method === 'notifications/initialized') {
      // notification, no response
    } else if (msg.method === 'tools/list') {
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'echo_tool',
              description: 'Echo back input message',
              inputSchema: {
                type: 'object',
                properties: { message: { type: 'string' } },
                required: ['message']
              }
            }
          ]
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    } else if (msg.method === 'tools/call') {
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: 'Echoed: ' + (msg.params?.arguments?.message || '') }]
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    }
  } catch {}
});
`
  );

  // 1. POST /api/mcp-servers
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/mcp-servers',
    headers: { authorization: `Bearer ${adminDeviceToken}` },
    payload: {
      name: 'Mock MCP',
      description: 'Mock stdio server for testing',
      type: 'stdio',
      command: 'node',
      args: [scriptPath],
      enabled: true,
      projectId: project.id
    }
  });

  assert.equal(createRes.statusCode, 200);
  const created = createRes.json();
  assert.equal(created.name, 'Mock MCP');
  assert.equal(created.enabled, true);

  // 2. GET /api/mcp-servers
  const listRes = await app.inject({
    method: 'GET',
    url: '/api/mcp-servers',
    headers: { authorization: `Bearer ${adminDeviceToken}` }
  });
  assert.equal(listRes.statusCode, 200);
  const list = listRes.json();
  assert.ok(list.some((s: any) => s.id === created.id));

  // 3. POST /api/mcp-servers/:id/sync
  const syncRes = await app.inject({
    method: 'POST',
    url: `/api/mcp-servers/${created.id}/sync`,
    headers: { authorization: `Bearer ${adminDeviceToken}` }
  });
  assert.equal(syncRes.statusCode, 200);
  const syncData = syncRes.json();
  assert.equal(syncData.ok, true);
  assert.equal(syncData.tools.length, 1);
  assert.equal(syncData.tools[0].name, 'echo_tool');

  // Verify stored tools in SQLite
  const stored = s.get('mcpServers', created.id);
  assert.ok(stored);
  assert.equal(stored.tools?.length, 1);
  assert.equal(stored.tools[0].name, 'echo_tool');

  // 4. Test connectMcpServers runtime
  const mcpSession = await connectMcpServers([stored]);
  assert.equal(mcpSession.tools.length, 1);
  assert.equal(mcpSession.tools[0].name, 'echo_tool');

  // Call the tool
  const toolResult = await mcpSession.tools[0].execute('call-1', { message: 'Hello MCP' });
  assert.deepEqual(toolResult.content, [{ type: 'text', text: 'Echoed: Hello MCP' }]);
  await mcpSession.close();

  // 5. PATCH /api/mcp-servers/:id (disable)
  const patchRes = await app.inject({
    method: 'PATCH',
    url: `/api/mcp-servers/${created.id}`,
    headers: { authorization: `Bearer ${adminDeviceToken}` },
    payload: { enabled: false }
  });
  assert.equal(patchRes.statusCode, 200);
  assert.equal(patchRes.json().enabled, false);

  // When disabled, connectMcpServers should ignore it
  const disabledStored = s.get('mcpServers', created.id);
  assert.ok(disabledStored);
  const disabledSession = await connectMcpServers([disabledStored]);
  assert.equal(disabledSession.tools.length, 0);
  await disabledSession.close();

  // 6. DELETE /api/mcp-servers/:id
  const delRes = await app.inject({
    method: 'DELETE',
    url: `/api/mcp-servers/${created.id}`,
    headers: { authorization: `Bearer ${adminDeviceToken}` }
  });
  assert.equal(delRes.statusCode, 200);
  assert.equal(s.get('mcpServers', created.id), undefined);
});

test('Agent configuration supports tools selection and MCP server binding', async () => {
  const mcpServer = s.put('mcpServers', {
    name: 'Shared MCP',
    enabled: true,
    projectId: project.id
  });

  // Create an agent with system mode, custom tools, and specific MCP server
  const agentRes = await app.inject({
    method: 'POST',
    url: '/api/agents',
    headers: { authorization: `Bearer ${adminDeviceToken}` },
    payload: {
      name: 'System Admin Agent',
      instructions: 'You maintain system infrastructure.',
      kind: 'system',
      tools: ['workspace', 'host_terminal'],
      mcpServers: [mcpServer.id],
      projectId: project.id
    }
  });

  assert.equal(agentRes.statusCode, 200);
  const agent = agentRes.json();
  assert.equal(agent.kind, 'system');
  assert.deepEqual(agent.tools, ['workspace', 'host_terminal']);
  assert.deepEqual(agent.mcpServers, [mcpServer.id]);

  // Patch agent tools
  const patchAgentRes = await app.inject({
    method: 'PATCH',
    url: `/api/agents/${agent.id}`,
    headers: { authorization: `Bearer ${adminDeviceToken}` },
    payload: {
      tools: ['workspace', 'host_terminal', 'propose_resource']
    }
  });
  assert.equal(patchAgentRes.statusCode, 200);
  assert.deepEqual(patchAgentRes.json().tools, ['workspace', 'host_terminal', 'propose_resource']);
});

test('Host terminal in system mode proposes action requiring admin approval', async () => {
  // Propose a host action as would occur when agent calls host_terminal tool
  const action = control.proposeAction(adminUser.id, 'Restart service test', {
    kind: 'host',
    command: 'echo "host executed successfully"',
    cwd: root,
    timeout: 30
  });

  assert.equal(action.status, 'awaiting_approval');

  // Verify approval decision executes the action
  const decideRes = await app.inject({
    method: 'POST',
    url: `/api/admin/actions/${action.id}/decision`,
    headers: { authorization: `Bearer ${adminDeviceToken}` },
    payload: { decision: 'approve' }
  });

  assert.equal(decideRes.statusCode, 200);
  await control.waitForAdminActions();

  const completed = s.get('adminActions', action.id);
  assert.equal(completed?.status, 'completed');
  assert.ok(completed?.result?.includes('host executed successfully'));
});
