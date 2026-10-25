import React, { useState } from 'react';
import { Bot, Terminal, Check, AlertCircle, Loader2, Sparkles, ChevronDown, Clock, Wrench } from 'lucide-react';
import { Markdown } from './markdown';

export interface SubagentChildInfo {
  agent: string;
  role?: string;
  model?: string;
  task?: string;
  status: 'running' | 'completed' | 'failed';
  currentTool?: string;
  currentToolArgs?: any;
  recentTools?: Array<{ tool: string; args?: any; endMs?: number }>;
  toolCalls?: Array<{ tool?: string; name?: string; args?: any; result?: any }>;
  toolCount?: number;
  turnCount?: number;
  tokens?: number;
  durationMs?: number;
  output?: string;
  partialOutput?: string;
  isError?: boolean;
}

export interface SubagentData {
  isSubagent: boolean;
  mode?: string;
  parentToolName: string;
  children: SubagentChildInfo[];
  overallStatus: 'running' | 'completed' | 'failed';
  task: string;
  durationMs?: number;
}

export function formatToolData(data: any): string {
  if (data === undefined || data === null) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'object') {
    if (typeof data.content === 'string') return data.content;
    if (typeof data.output === 'string') return data.output;
    if (Array.isArray(data.content)) {
      return data.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
    }
    return JSON.stringify(data, null, 2);
  }
  return String(data);
}

export function isSubagent(name?: string, args?: any): boolean {
  const n = (name || '').toLowerCase();
  if (n === 'subagent' || n === 'acp_delegate' || n === 'invoke_subagent' || n === 'delegate') return true;
  if (n.includes('subagent') || n.includes('delegate')) return true;
  if (args && typeof args === 'object') {
    if (args.agent || args.subagent || args.TypeName || args.Role || args.agents || args.chain) return true;
  }
  return false;
}

export function parseSubagentInfo(tool: any, isRunning = false): SubagentData | null {
  if (!tool) return null;
  const name = tool.name || tool.data?.name || '';
  const args = tool.args || tool.data?.args || {};
  if (!isSubagent(name, args)) return null;

  const rawResult = tool.result !== undefined ? tool.result : tool.data?.result;
  const rawPartial = tool.partialUpdate !== undefined ? tool.partialUpdate : (tool.data?.partialResult || tool.data?.partialUpdate);
  const isErr = !!(tool.isError || tool.data?.isError);
  const durMs = tool.durationMs || tool.data?.durationMs;

  let details = rawResult?.details || rawPartial?.details;
  if (!details && typeof rawPartial === 'string') {
    try {
      const parsed = JSON.parse(rawPartial);
      details = parsed?.details || parsed;
    } catch {}
  }
  if (!details && typeof rawResult === 'string') {
    try {
      const parsed = JSON.parse(rawResult);
      details = parsed?.details || parsed;
    } catch {}
  }

  const mode = args.mode || details?.mode || 'single';
  const task = args.task || args.prompt || args.Prompt || args.instructions || args.action || '';
  const defaultAgent = args.agent || args.subagent || args.TypeName || args.Role || (name === 'subagent' ? 'subagent' : name);
  const defaultModel = args.model || args.Model || '';

  const overallStatus = isRunning && rawResult === undefined ? 'running' : isErr ? 'failed' : 'completed';

  const progressList: any[] = Array.isArray(details?.progress) ? details.progress : [];
  const resultsList: any[] = Array.isArray(details?.results) ? details.results : [];
  const declaredAgents: string[] = Array.isArray(args.agents) ? args.agents : Array.isArray(args.chain) ? args.chain : [];
  const maxChildren = Math.max(resultsList.length, progressList.length, declaredAgents.length);

  const children: SubagentChildInfo[] = [];

  if (maxChildren > 0) {
    for (let i = 0; i < maxChildren; i++) {
      const res = resultsList[i] || {};
      const prog = progressList[i] || {};
      const agentName = res.agent || prog.agent || declaredAgents[i] || defaultAgent;
      const childModel = res.model || prog.model || defaultModel;
      const childTask = res.task || prog.task || task;
      const childStatus = (isRunning && rawResult === undefined && !res.finalOutput && !res.error)
        ? 'running'
        : (res.error || (isErr && i === maxChildren - 1) ? 'failed' : 'completed');

      const childOutput = res.finalOutput || res.output || (typeof rawResult === 'string' ? rawResult : rawResult?.content?.[0]?.text) || '';
      const partialOut = (typeof rawPartial === 'string' ? rawPartial : rawPartial?.content?.[0]?.text) || (prog.recentOutput ? prog.recentOutput.join('\n') : '');

      children.push({
        agent: agentName,
        model: childModel,
        task: childTask,
        status: childStatus,
        currentTool: prog.currentTool,
        currentToolArgs: prog.currentToolArgs,
        recentTools: prog.recentTools || [],
        toolCalls: res.toolCalls || [],
        toolCount: res.toolCount || prog.toolCount || (res.toolCalls ? res.toolCalls.length : 0),
        turnCount: res.usage?.turns || prog.turnCount || 0,
        tokens: prog.tokens,
        durationMs: res.progress?.durationMs || prog.durationMs || durMs,
        output: childOutput,
        partialOutput: partialOut,
        isError: !!(res.error || (isErr && i === maxChildren - 1))
      });
    }
  } else {
    const childOutput = (typeof rawResult === 'string' ? rawResult : rawResult?.content?.[0]?.text || rawResult?.output || rawResult?.result) || '';
    const partialOut = typeof rawPartial === 'string' ? rawPartial : rawPartial?.content?.[0]?.text || '';

    children.push({
      agent: defaultAgent,
      model: defaultModel,
      task,
      status: overallStatus,
      durationMs: durMs,
      output: childOutput,
      partialOutput: partialOut,
      isError: isErr
    });
  }

  return {
    isSubagent: true,
    mode,
    parentToolName: name,
    children,
    overallStatus,
    task,
    durationMs: durMs
  };
}

export function getSubagentActivityText(subData: SubagentData): string {
  const active = subData.children.find(c => c.status === 'running') || subData.children[0];
  if (!active) return 'Subagent active…';
  const agentName = active.agent || 'subagent';
  if (active.currentTool) {
    const target = active.currentToolArgs?.Path || active.currentToolArgs?.path || active.currentToolArgs?.command || active.currentToolArgs?.cmd || '';
    const argStr = target ? ` (${String(target).slice(0, 45)})` : '';
    return `Subagent [${agentName}] executing ${active.currentTool}${argStr}…`;
  }
  if (active.partialOutput) {
    return `Subagent [${agentName}] formulating findings…`;
  }
  if (active.task) {
    return `Subagent [${agentName}] ${active.task.slice(0, 50)}…`;
  }
  return `Subagent [${agentName}] working…`;
}

export function SubagentCard({ tool, isRunning, formatToolData: customFormat }: any) {
  const formatter = customFormat || formatToolData;
  const subData = parseSubagentInfo(tool, isRunning);
  if (!subData) return null;

  const [expanded, setExpanded] = useState<boolean>(Boolean(isRunning || subData.overallStatus === 'running'));
  const [activeTab, setActiveTab] = useState<number>(0);

  const activeChild = subData.children[activeTab] || subData.children[0];
  if (!activeChild) return null;

  const agentSlug = (activeChild.agent || 'subagent').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const durationSec = activeChild.durationMs ? (activeChild.durationMs / 1000).toFixed(1) + 's' : (subData.durationMs ? (subData.durationMs / 1000).toFixed(1) + 's' : '');

  const toolsList = (activeChild.toolCalls && activeChild.toolCalls.length > 0)
    ? activeChild.toolCalls
    : (activeChild.recentTools || []).map((t: any) => ({ tool: t.tool, args: t.args }));

  return (
    <div className={`subagent-card agent-${agentSlug} ${activeChild.status} ${expanded ? 'open' : ''}`}>
      <div className="subagent-header" onClick={() => setExpanded((prev: boolean) => !prev)}>
        <div className="subagent-identity">
          <span className="subagent-tag">
            <Bot size={13} />
            <span>SUBAGENT</span>
          </span>
          <span className={`subagent-pill agent-${agentSlug}`}>
            {activeChild.agent}
          </span>
          {activeChild.model && (
            <span className="subagent-model">
              <Sparkles size={10} />
              <span>{activeChild.model}</span>
            </span>
          )}
          <span className={`subagent-status-badge ${activeChild.status}`}>
            {activeChild.status === 'running' ? (
              <><Loader2 size={11} className="spin" /> active</>
            ) : activeChild.status === 'completed' ? (
              <><Check size={11} /> complete</>
            ) : (
              <><AlertCircle size={11} /> failed</>
            )}
          </span>
        </div>
        <div className="subagent-header-meta">
          {activeChild.toolCount ? (
            <span className="subagent-metric" title="Tools executed by subagent">
              <Wrench size={10} style={{ display: 'inline', marginRight: 3 }} />
              {activeChild.toolCount} {activeChild.toolCount === 1 ? 'tool' : 'tools'}
            </span>
          ) : null}
          {durationSec ? (
            <span className="subagent-metric">
              <Clock size={10} style={{ display: 'inline', marginRight: 3 }} />
              {durationSec}
            </span>
          ) : null}
          <button type="button" className="icon-button" style={{ padding: 2 }} aria-label={expanded ? 'Collapse subagent' : 'Expand subagent'}>
            <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="subagent-body">
          {subData.children.length > 1 && (
            <div className="subagent-tabs">
              {subData.children.map((c, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`subagent-tab-btn ${activeTab === idx ? 'active' : ''}`}
                  onClick={() => setActiveTab(idx)}
                >
                  {c.agent} {c.status === 'running' ? '•' : ''}
                </button>
              ))}
            </div>
          )}

          {(activeChild.task || subData.task) && (
            <div className="subagent-task">
              <strong>Objective:</strong> {activeChild.task || subData.task}
            </div>
          )}

          {activeChild.status === 'running' && (
            <div className="subagent-live-row">
              <Loader2 size={13} className="spin" />
              <span>
                {activeChild.currentTool ? (
                  <>Running tool: <code>{activeChild.currentTool}</code> {activeChild.currentToolArgs?.Path || activeChild.currentToolArgs?.path || activeChild.currentToolArgs?.command || ''}</>
                ) : activeChild.partialOutput ? (
                  'Streaming findings…'
                ) : (
                  'Working on assigned task…'
                )}
              </span>
            </div>
          )}

          {activeChild.currentTool && activeChild.status === 'running' && (
            <div className="subagent-current-tool">
              <Terminal size={12} />
              <strong>{activeChild.currentTool}</strong>
              {activeChild.currentToolArgs && (
                <code>{formatter(activeChild.currentToolArgs).slice(0, 100)}</code>
              )}
            </div>
          )}

          {toolsList.length > 0 && (
            <details className="subagent-log-section" open={activeChild.status === 'running'}>
              <summary>
                <Terminal size={12} />
                <span>Internal tool activity ({toolsList.length})</span>
              </summary>
              <div className="subagent-tools-list">
                {toolsList.map((t: any, idx: number) => {
                  const tName = t.tool || t.name || 'tool';
                  const tArgs = t.args ? formatter(t.args) : '';
                  return (
                    <div key={idx} className="subagent-tool-item">
                      <Terminal size={11} />
                      <strong>{tName}</strong>
                      {tArgs && <code>{tArgs.slice(0, 85)}</code>}
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {activeChild.partialOutput && !activeChild.output && (
            <div className="subagent-partial-output">
              <small style={{ color: 'var(--muted)', fontWeight: 600 }}>Live subagent output</small>
              <pre>{activeChild.partialOutput}</pre>
            </div>
          )}

          {activeChild.output && (
            <div className="subagent-output">
              <div className="subagent-output-header">
                <Sparkles size={12} />
                <span>Subagent Findings</span>
              </div>
              <Markdown>{activeChild.output}</Markdown>
            </div>
          )}

          {activeChild.isError && !activeChild.output && (
            <div className="error banner" style={{ margin: 0 }}>
              <AlertCircle size={14} />
              <span>Subagent execution encountered an error.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
