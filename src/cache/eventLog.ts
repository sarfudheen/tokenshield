// Pure Node module — no vscode import. Shared by the extension bundle and the
// standalone MCP cache server bundle (dist/cache-server.js).
import * as fs from 'fs';
import * as path from 'path';
import { CACHE_DIR } from './store';

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
}

interface EventsFileFormat {
  version: 1;
  events: DiskSavingsEvent[];
}

export function recordDiskEvent(
  workspaceRoot: string,
  event: Omit<DiskSavingsEvent, 'id' | 'timestamp' | 'costSavedUsd'> & { costSavedUsd?: number }
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

    const newEvent: DiskSavingsEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      directive: event.directive,
      source: event.source,
      tokensSaved: event.tokensSaved,
      costSavedUsd,
      details: event.details,
      sessionNumber: event.sessionNumber,
    };

    data.events.unshift(newEvent);
    // Keep max 100 recent events on disk
    if (data.events.length > 100) {
      data.events = data.events.slice(0, 100);
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
