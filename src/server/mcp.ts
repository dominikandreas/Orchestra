import { McpClient, StdioTransport, StreamableHttpTransport, toLlmContent, type Tool } from '@earendil-works/pi-mcp';
import { Type } from 'typebox';
import { get, put, admin, type Row } from './store.js';

// Host-launched MCP configurations are administrator-owned executable code.
// Project members may discover tools, but must never receive environment/header secrets.
export function safeMcpServer(server:Row,user:Row){
 if(admin(user))return server;
 return {id:server.id,name:server.name,description:server.description,type:server.type,enabled:server.enabled,projectId:server.projectId,tools:server.tools,lastSynced:server.lastSynced};
}
export function selectMcpServers(servers:Row[],projectId:string,ids?:string[]){
 return servers.filter(s=>s.enabled&&(!s.projectId||s.projectId===projectId)&&(ids===undefined||ids.includes(s.id)));
}
async function bounded<T>(work:Promise<T>,timeoutMs=15000):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('MCP operation timed out')),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}

export interface McpServerConfig {
  id: string;
  name: string;
  description?: string;
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
  projectId?: string;
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
  lastSynced?: string;
  error?: string;
}

export function createTransport(server: Row) {
  if (server.type === 'sse') {
    if (!server.url) throw Error('SSE MCP server requires a url');
    return new StreamableHttpTransport({
      url: server.url,
      headers: server.env
    });
  }

  if (!server.command) throw Error('stdio MCP server requires a command');
  return new StdioTransport({
    command: server.command,
    args: Array.isArray(server.args) ? server.args : (server.args ? String(server.args).split(/\s+/).filter(Boolean) : []),
    cwd: server.cwd || process.cwd(),
    env: { ...(process.env as Record<string, string>), ...(server.env || {}) }
  });
}

export async function syncMcpServerTools(server: Row): Promise<Tool[]> {
  const transport = createTransport(server);
  const client = new McpClient({ name: 'orchestra-sync', version: '1.0.0' });
  try {
    await bounded(client.connect(transport));
    const tools = await bounded(client.listTools());
    const cleanTools = tools.map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} }
    }));

    if(get('mcpServers',server.id)?.updated===server.updated)put('mcpServers', {
      id: server.id,
      tools: cleanTools,
      lastSynced: new Date().toISOString(),
      error: null
    });

    return tools;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    if(get('mcpServers',server.id)?.updated===server.updated)put('mcpServers', {
      id: server.id,
      error: errorMsg,
      lastSynced: new Date().toISOString()
    });
    throw err;
  } finally {
    try {
      await client.close();
    } catch {}
  }
}

export interface ActiveMcpSession {
  tools: any[];
  close: () => Promise<void>;
}

export async function connectMcpServers(servers: Row[],authorize?:(server:Row)=>void): Promise<ActiveMcpSession> {
  const activeClients: McpClient[] = [];
  const piTools: any[] = [];
  const registeredNames = new Set(['workspace','host_terminal','submit_review','propose_resource','propose_workflow','propose_deployment_connection','bash','read','write','edit']);

  for (const server of servers) {
    if (!server.enabled) continue;
    let client:McpClient|undefined;
    try {
      authorize?.(server);
      const transport = createTransport(server);
      const connected = new McpClient({ name: `orchestra-agent-${server.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`, version: '1.0.0' });
      client=connected;
      await bounded(connected.connect(transport));
      const serverTools = await bounded(connected.listTools());
      activeClients.push(connected);
      for (const t of serverTools) {
        // Namespace tool name if conflicting
        let toolName = t.name;
        if (registeredNames.has(toolName)) {
          const prefix = `mcp_${server.id.replace(/[^a-zA-Z0-9]/g,'').slice(0,12)}`;
          const base=`${prefix}_${t.name.replace(/[^a-zA-Z0-9_-]/g,'_')}`.slice(0,60);
          toolName=base;let suffix=1;
          while(registeredNames.has(toolName))toolName=`${base}_${suffix++}`;
        }
        registeredNames.add(toolName);

        const schema = t.inputSchema && typeof t.inputSchema === 'object' && Object.keys(t.inputSchema).length > 0
          ? t.inputSchema
          : Type.Object({});

        piTools.push({
          name: toolName,
          label: `${server.name}: ${t.name}`,
          description: t.description || `Tool ${t.name} from ${server.name} MCP server`,
          parameters: schema,
          execute: async (_callId: string, args: any) => {
            try {
              authorize?.(server);
              const res = await bounded(connected.callTool(t.name, args || {}),120000);
              authorize?.(server);
              const content = toLlmContent(res);
              return {
                content: content.map(c => c.type === 'text' ? { type: 'text', text: c.text } : { type: 'image', data: c.data, mimeType: c.mimeType }),
                isError: res.isError
              };
            } catch (err: any) {
              return {
                isError: true,
                content: [{ type: 'text', text: `MCP tool execution failed: ${err?.message || String(err)}` }]
              };
            }
          }
        });
      }
    } catch (e: any) {
      await client?.close().catch(()=>{});
      console.warn(`[MCP] Failed to connect to server ${server.name} (${server.id}):`, e.message);
    }
  }

  return {
    tools: piTools,
    close: async () => {
      for (const client of activeClients) {
        try {
          await client.close();
        } catch {}
      }
    }
  };
}
