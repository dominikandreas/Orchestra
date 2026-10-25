#!/usr/bin/env node

import { mkdirSync, copyFileSync, unlinkSync, statSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/**
 * Generate a UUIDv7 based on timestamp in ms and a local sequence index.
 */
export function uuidv7(timestampMs, index = 0) {
  const timeHex = BigInt(timestampMs).toString(16).padStart(12, '0');
  const indexHex = (index % 4096).toString(16).padStart(3, '0');
  const rand1 = (((Math.random() * 0x3fff) | 0x8000) & 0xbfff | 0x8000).toString(16).padStart(4, '0');
  const rand2 = Math.random().toString(16).slice(2, 14).padEnd(12, '0');
  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-7${indexHex}-${rand1}-${rand2}`;
}

export function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Parse a Pi session JSONL file into session metadata and conversational turns.
 */
export function parseSessionJsonl(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);

  let sessionMeta = null;
  let model = null;
  let provider = null;
  let thinkingLevel = 'medium';
  const entries = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'session') {
        sessionMeta = obj;
      } else if (obj.type === 'model_change') {
        provider = obj.provider || provider;
        model = obj.modelId || model;
      } else if (obj.type === 'thinking_level_change') {
        thinkingLevel = obj.thinkingLevel || thinkingLevel;
      }
      entries.push(obj);
    } catch {
      // Ignore unparseable line
    }
  }

  const turns = [];
  let currentTurn = null;

  for (const entry of entries) {
    if (entry.type === 'message' && entry.message) {
      const msg = entry.message;
      if (msg.role === 'user') {
        if (currentTurn) turns.push(currentTurn);
        let userText = '';
        if (typeof msg.content === 'string') {
          userText = msg.content;
        } else if (Array.isArray(msg.content)) {
          userText = msg.content
            .filter(c => c && (c.type === 'text' || typeof c === 'string'))
            .map(c => (typeof c === 'string' ? c : c.text || ''))
            .join('\n');
        }
        currentTurn = {
          userTimestamp: entry.timestamp || sessionMeta?.timestamp || new Date().toISOString(),
          userText: userText.trim(),
          assistantEntries: []
        };
      } else if (msg.role === 'assistant' && currentTurn) {
        currentTurn.assistantEntries.push(entry);
      }
    }
  }
  if (currentTurn) turns.push(currentTurn);

  return {
    sessionMeta,
    model,
    provider,
    thinkingLevel,
    turns,
    entries
  };
}

/**
 * Main import function.
 */
export async function importPiSession(sourcePath, options = {}) {
  const absSource = resolve(sourcePath);
  if (!existsSync(absSource)) {
    throw new Error(`Source session file not found: ${absSource}`);
  }

  const {
    mode = 'move', // 'move' | 'copy'
    dataDir = resolve(process.env.ORCHESTRA_DATA_DIR || process.env.RELAY_DATA_DIR || '.data'),
    userId: explicitUserId,
    connectionId: explicitConnectionId,
    projectId = 'cfdca829-611b-4668-be23-d16a2391a718',
    title: explicitTitle,
    dryRun = false,
    verbose = true
  } = options;

  const log = (...args) => { if (verbose) console.log(...args); };

  log(`[import-pi-session] Reading source session: ${absSource}`);
  const parsed = parseSessionJsonl(absSource);

  const sessionId = parsed.sessionMeta?.id || basename(absSource).replace(/.*_([a-f0-9-]+)\.jsonl$/, '$1');
  if (!sessionId) {
    throw new Error(`Could not determine session ID from: ${absSource}`);
  }

  const threadId = sessionId;
  const adminDir = join(dataDir, 'admin-pi');
  const destDir = join(adminDir, 'sessions', threadId);
  const destFile = join(destDir, basename(absSource));

  log(`[import-pi-session] Session ID / Thread ID: ${threadId}`);
  log(`[import-pi-session] Found ${parsed.turns.length} user/assistant turn(s) in session`);

  // Connect to SQLite DB
  const dbPath = join(dataDir, 'relay.sqlite');
  if (!existsSync(dbPath)) {
    throw new Error(`Orchestra database not found at ${dbPath}. Verify dataDir.`);
  }
  const db = new DatabaseSync(dbPath);

  // Determine User
  let authorId = explicitUserId;
  if (!authorId) {
    const users = db.prepare("SELECT data FROM records WHERE kind=?").all("users").map(r => JSON.parse(r.data));
    const ownerOrAdmin = users.find(u => !u.disabled && (u.role === 'owner' || u.role === 'admin'));
    authorId = ownerOrAdmin?.id || users[0]?.id;
    if (!authorId) throw new Error('No admin user found in database records');
  }

  // Determine Connection
  let connectionId = explicitConnectionId;
  const conns = db.prepare("SELECT data FROM records WHERE kind=?").all("connections").map(r => JSON.parse(r.data));
  const connected = conns.filter(c => c.status === 'connected');

  if (!connectionId) {
    // Try to match provider
    if (parsed.provider) {
      const match = connected.find(c => c.provider === parsed.provider || (parsed.provider === 'agy' && c.name?.toLowerCase().includes('agy')));
      if (match) connectionId = match.id;
    }
    if (!connectionId) {
      connectionId = connected[0]?.id || conns[0]?.id;
    }
  }

  const model = parsed.model || 'gemini-3.8-flash';
  const thinkingLevel = parsed.thinkingLevel || 'medium';

  const firstTurn = parsed.turns[0];
  const derivedTitle = explicitTitle ||
    (firstTurn?.userText ? firstTurn.userText.slice(0, 80).replace(/\s+/g, ' ').trim() : 'Imported Pi Conversation');

  const sessionCreated = parsed.sessionMeta?.timestamp || firstTurn?.userTimestamp || new Date().toISOString();
  const lastTurn = parsed.turns[parsed.turns.length - 1];
  const lastAssistantEntry = lastTurn?.assistantEntries[lastTurn.assistantEntries.length - 1];
  const sessionUpdated = lastAssistantEntry?.timestamp || lastTurn?.userTimestamp || sessionCreated;

  log(`[import-pi-session] Target config:`);
  log(`  - Thread ID: ${threadId}`);
  log(`  - Title: "${derivedTitle}"`);
  log(`  - Author ID: ${authorId}`);
  log(`  - Connection ID: ${connectionId}`);
  log(`  - Model: ${model}`);
  log(`  - Thinking Level: ${thinkingLevel}`);
  log(`  - Destination File: ${destFile}`);
  log(`  - Transfer Mode: ${mode}`);

  if (dryRun) {
    log(`[import-pi-session] DRY-RUN complete. No files moved or database rows modified.`);
    return {
      threadId,
      title: derivedTitle,
      destFile,
      turnsCount: parsed.turns.length,
      dryRun: true
    };
  }

  // File Transfer
  log(`[import-pi-session] Step 1: Copying session file...`);
  mkdirSync(destDir, { recursive: true, mode: 0o700 });
  copyFileSync(absSource, destFile);
  chmodSync(destFile, 0o600);

  // Check integrity
  const srcStat = statSync(absSource);
  const dstStat = statSync(destFile);
  if (srcStat.size !== dstStat.size) {
    throw new Error(`File size mismatch after copy: ${srcStat.size} vs ${dstStat.size}`);
  }
  const srcHash = hash(readFileSync(absSource));
  const dstHash = hash(readFileSync(destFile));
  if (srcHash !== dstHash) {
    throw new Error(`File SHA256 checksum mismatch after copy: ${srcHash} vs ${dstHash}`);
  }
  log(`[import-pi-session] Copy verified (${dstStat.size} bytes, sha256: ${dstHash.slice(0, 16)}...)`);

  if (mode === 'move') {
    log(`[import-pi-session] Step 2: Removing source file to complete move...`);
    unlinkSync(absSource);
  }

  // Database updates
  log(`[import-pi-session] Step 3: Populating database records (adminThreads, adminMessages, adminRuns, events)...`);

  const threadRecord = {
    id: threadId,
    created: sessionCreated,
    authorId,
    title: derivedTitle,
    permissionMode: 'manual',
    updated: sessionUpdated,
    connectionId,
    model,
    thinkingLevel,
    sessionFile: destFile
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    // 1. Thread record
    db.prepare('INSERT OR REPLACE INTO records(kind, id, data) VALUES(?, ?, ?)')
      .run('adminThreads', threadId, JSON.stringify(threadRecord));

    let seq = 0;
    for (let i = 0; i < parsed.turns.length; i++) {
      const turn = parsed.turns[i];
      const uTime = new Date(turn.userTimestamp).getTime() || Date.now();
      const uMsgId = uuidv7(uTime, seq++);

      // User Message
      const userMsg = {
        id: uMsgId,
        threadId,
        role: 'user',
        text: turn.userText,
        context: { page: 'assistant', projectId },
        images: [],
        attachments: [],
        created: turn.userTimestamp,
        updated: turn.userTimestamp
      };
      db.prepare('INSERT OR REPLACE INTO records(kind, id, data) VALUES(?, ?, ?)')
        .run('adminMessages', uMsgId, JSON.stringify(userMsg));

      // Collect thinking and text from assistant entries
      const thinkingParts = [];
      const textEntries = [];

      for (const a of turn.assistantEntries) {
        const content = Array.isArray(a.message?.content) ? a.message.content : [a.message?.content];
        for (const c of content) {
          if (!c) continue;
          if (c.type === 'thinking' && c.thinking) {
            thinkingParts.push({ text: c.thinking, timestamp: a.timestamp || a.message?.timestamp });
          }
          if (c.type === 'text' && c.text && c.text.trim()) {
            textEntries.push({ text: c.text.trim(), timestamp: a.timestamp || a.message?.timestamp });
          }
        }
      }

      if (textEntries.length > 0 || thinkingParts.length > 0) {
        const firstA = turn.assistantEntries[0]?.timestamp || turn.userTimestamp;
        const lastA = turn.assistantEntries[turn.assistantEntries.length - 1]?.timestamp || turn.userTimestamp;
        const rTime = new Date(firstA).getTime() || uTime;
        const runId = uuidv7(rTime, seq++);

        const runRecord = {
          id: runId,
          threadId,
          authorId,
          title: turn.userText.slice(0, 90).replace(/\s+/g, ' ').trim(),
          status: 'completed',
          context: { page: 'assistant', projectId },
          thinkingLevel,
          created: firstA,
          updated: lastA,
          finished: lastA
        };
        db.prepare('INSERT OR REPLACE INTO records(kind, id, data) VALUES(?, ?, ?)')
          .run('adminRuns', runId, JSON.stringify(runRecord));

        // Thinking events
        for (const tp of thinkingParts) {
          db.prepare('INSERT INTO events(job, type, data, created) VALUES(?, ?, ?, ?)')
            .run(runId, 'thinking', JSON.stringify(tp.text), tp.timestamp || firstA);
        }

        // Assistant Messages
        for (const textItem of textEntries) {
          const aTime = new Date(textItem.timestamp || lastA).getTime() || rTime;
          const aMsgId = uuidv7(aTime, seq++);
          const assistantMsg = {
            id: aMsgId,
            threadId,
            role: 'assistant',
            text: textItem.text,
            runId,
            created: textItem.timestamp || lastA,
            updated: textItem.timestamp || lastA
          };
          db.prepare('INSERT OR REPLACE INTO records(kind, id, data) VALUES(?, ?, ?)')
            .run('adminMessages', aMsgId, JSON.stringify(assistantMsg));
        }

        // Final result event
        if (textEntries.length > 0) {
          const lastText = textEntries[textEntries.length - 1];
          db.prepare('INSERT INTO events(job, type, data, created) VALUES(?, ?, ?, ?)')
            .run(runId, 'result', JSON.stringify(lastText.text), lastText.timestamp || lastA);
        }
      }
    }

    db.exec('COMMIT');
    log(`[import-pi-session] Database transaction committed successfully.`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Try optional SessionManager verification
  try {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent');
    const sm = SessionManager.open(destFile);
    log(`[import-pi-session] Verified session file opens cleanly via SessionManager. Entries: ${sm.getBranch().length}`);
  } catch (e) {
    // SessionManager is optional
  }

  return {
    threadId,
    title: derivedTitle,
    sessionFile: destFile,
    turnsCount: parsed.turns.length,
    dryRun: false
  };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('import-pi-session.mjs')) {
  const args = process.argv.slice(2);
  let sessionPath = null;
  const options = {};

  for (const arg of args) {
    if (arg === '--copy') {
      options.mode = 'copy';
    } else if (arg === '--move') {
      options.mode = 'move';
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--mode=')) {
      options.mode = arg.split('=')[1];
    } else if (arg.startsWith('--data-dir=')) {
      options.dataDir = resolve(arg.split('=')[1]);
    } else if (arg.startsWith('--user=')) {
      options.userId = arg.split('=')[1];
    } else if (arg.startsWith('--connection=')) {
      options.connectionId = arg.split('=')[1];
    } else if (arg.startsWith('--project=')) {
      options.projectId = arg.split('=')[1];
    } else if (arg.startsWith('--title=')) {
      options.title = arg.split('=')[1];
    } else if (!arg.startsWith('-') && !sessionPath) {
      sessionPath = arg;
    }
  }

  if (!sessionPath) {
    console.error('Usage: import-pi-session.mjs <session-file-path> [--move|--copy] [--dry-run] [--data-dir=PATH] [--project=PROJECT_ID]');
    process.exit(1);
  }

  try {
    const result = await importPiSession(sessionPath, options);
    console.log('\n--- Import Summary ---');
    console.log(`Thread ID:      ${result.threadId}`);
    console.log(`Title:          ${result.title}`);
    console.log(`Session File:   ${result.sessionFile || '(dry-run)'}`);
    console.log(`Turns Imported: ${result.turnsCount}`);
    console.log(`Status:         SUCCESS`);
  } catch (err) {
    console.error(`\nImport failed: ${err.message}`);
    process.exit(1);
  }
}
