// Pure Node module — no vscode import. Shared by the extension bundle and the
// standalone MCP cache server bundle (dist/cache-server.js).
import * as fs from 'fs';
import * as path from 'path';
import { CACHE_DIR } from './store';

import { SecretSanitizer } from './sanitizer';

export const EVENTS_FILE = 'events.json';

export interface DiskSavingsEvent {
  id: string;
  timestamp: string; // ISO string
  directive: string;
  source: string;
  tokensSaved: number;
  costSavedUsd: number;
  details: string;
  sessionNumber?: number;
  beforeTokens?: number;
  afterTokens?: number;
  reductionPercent?: number;
  modelName?: string;
  beforeContent?: string;
  afterContent?: string;
}

interface EventsFileFormat {
  version: 1;
  events: DiskSavingsEvent[];
}

export function recordDiskEvent(
  workspaceRoot: string,
  event: Omit<DiskSavingsEvent, 'id' | 'timestamp' | 'costSavedUsd'> & {
    id?: string;
    timestamp?: string;
    costSavedUsd?: number;
    beforeTokens?: number;
    afterTokens?: number;
    reductionPercent?: number;
    modelName?: string;
    beforeContent?: string;
    afterContent?: string;
  }
): DiskSavingsEvent {
  const cacheDir = path.join(workspaceRoot, CACHE_DIR);
  const filePath = path.join(cacheDir, EVENTS_FILE);

  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    let data: EventsFileFormat = { version: 1, events: [] };
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        data = JSON.parse(raw);
        if (!Array.isArray(data.events)) {
          data.events = [];
        }
      } catch {
        data = { version: 1, events: [] };
      }
    }

    const costSavedUsd = event.costSavedUsd !== undefined
      ? event.costSavedUsd
      : (event.tokensSaved / 1_000_000) * 0.15; // default lightweight tier rate ($0.15/1M)

    // Truncate disk-stored payloads to 50KB to keep events.json lean and redact secrets
    const maxDiskPayload = 50_000;
    const rawBefore = event.beforeContent
      ? (event.beforeContent.length > maxDiskPayload ? event.beforeContent.slice(0, maxDiskPayload) + '\n// [... Remaining payload truncated on disk ...]' : event.beforeContent)
      : undefined;
    const rawAfter = event.afterContent
      ? (event.afterContent.length > maxDiskPayload ? event.afterContent.slice(0, maxDiskPayload) + '\n// [... Remaining payload truncated on disk ...]' : event.afterContent)
      : undefined;

    const beforeContent = rawBefore ? SecretSanitizer.redact(rawBefore) : undefined;
    const afterContent = rawAfter ? SecretSanitizer.redact(rawAfter) : undefined;
    const source = SecretSanitizer.redact(event.source);
    const details = SecretSanitizer.redact(event.details);

    const newEvent: DiskSavingsEvent = {
      id: event.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: event.timestamp || new Date().toISOString(),
      directive: event.directive,
      source,
      tokensSaved: event.tokensSaved,
      costSavedUsd,
      details,
      sessionNumber: event.sessionNumber,
      beforeTokens: event.beforeTokens,
      afterTokens: event.afterTokens,
      reductionPercent: event.reductionPercent,
      modelName: event.modelName,
      beforeContent,
      afterContent,
    };

    data.events.unshift(newEvent);
    // Keep max 100 recent events on disk and enforce 1MB maximum file limit
    const MAX_EVENTS = 100;
    const MAX_FILE_BYTES = 1024 * 1024; // 1 MB
    if (data.events.length > MAX_EVENTS) {
      data.events = data.events.slice(0, MAX_EVENTS);
    }
    while (data.events.length > 10 && Buffer.byteLength(JSON.stringify(data), 'utf-8') > MAX_FILE_BYTES) {
      data.events.pop();
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return newEvent;
  } catch (err) {
    // Non-fatal if disk write fails
    return {
      id: `evt-${Date.now()}`,
      timestamp: new Date().toISOString(),
      directive: event.directive,
      source: event.source,
      tokensSaved: event.tokensSaved,
      costSavedUsd: event.costSavedUsd || 0,
      details: event.details,
    };
  }
}

export function readDiskEvents(workspaceRoot: string): DiskSavingsEvent[] {
  const filePath = path.join(workspaceRoot, CACHE_DIR, EVENTS_FILE);
  try {
    if (!fs.existsSync(filePath)) { return []; }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data: EventsFileFormat = JSON.parse(raw);
    return Array.isArray(data.events) ? data.events : [];
  } catch {
    return [];
  }
}

export function clearDiskEvents(workspaceRoot: string): void {
  const filePath = path.join(workspaceRoot, CACHE_DIR, EVENTS_FILE);
  try {
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({ version: 1, events: [] }, null, 2), 'utf-8');
    }
  } catch {}
}
