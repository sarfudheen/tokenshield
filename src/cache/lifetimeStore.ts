// Pure Node module — no vscode import. Shared across extension and tools.
import * as fs from 'fs';
import * as path from 'path';
import { CACHE_DIR } from './store';
import { readDiskEvents, DiskSavingsEvent } from './eventLog';

export const LIFETIME_FILE = 'lifetime.json';

export interface ArchivedSessionRecord {
  sessionNumber: number;
  startedAt: string; // ISO string
  endedAt: string; // ISO string
  totalTokensSaved: number;
  totalCostSavedUsd: number;
  eventsCount: number;
  modelName: string;
  events: DiskSavingsEvent[];
}

export interface LifetimeData {
  version: 1;
  currentSessionNumber: number;
  currentSessionStartedAt: string; // ISO string
  lifetimeTokensSaved: number;
  lifetimeCostSavedUsd: number;
  pastSessions: ArchivedSessionRecord[];
}

function getDefaultLifetimeData(): LifetimeData {
  return {
    version: 1,
    currentSessionNumber: 1,
    currentSessionStartedAt: new Date().toISOString(),
    lifetimeTokensSaved: 0,
    lifetimeCostSavedUsd: 0,
    pastSessions: [],
  };
}

export function readLifetimeData(workspaceRoot: string): LifetimeData {
  const cacheDir = path.join(workspaceRoot, CACHE_DIR);
  const filePath = path.join(cacheDir, LIFETIME_FILE);

  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data && data.version === 1) {
        return {
          version: 1,
          currentSessionNumber: typeof data.currentSessionNumber === 'number' ? data.currentSessionNumber : 1,
          currentSessionStartedAt: data.currentSessionStartedAt || new Date().toISOString(),
          lifetimeTokensSaved: typeof data.lifetimeTokensSaved === 'number' ? data.lifetimeTokensSaved : 0,
          lifetimeCostSavedUsd: typeof data.lifetimeCostSavedUsd === 'number' ? data.lifetimeCostSavedUsd : 0,
          pastSessions: Array.isArray(data.pastSessions) ? data.pastSessions : [],
        };
      }
    }
  } catch {
    // Non-fatal, proceed to bootstrap
  }

  // If lifetime.json doesn't exist yet, bootstrap from existing events.json
  const defaultData = getDefaultLifetimeData();
  const existingEvents = readDiskEvents(workspaceRoot);
  if (existingEvents.length > 0) {
    let sumTokens = 0;
    let sumCost = 0;
    let maxSession = 1;

    for (const ev of existingEvents) {
      sumTokens += typeof ev.tokensSaved === 'number' ? ev.tokensSaved : 0;
      sumCost += typeof ev.costSavedUsd === 'number' ? ev.costSavedUsd : 0;
      if (typeof ev.sessionNumber === 'number' && ev.sessionNumber > maxSession) {
        maxSession = ev.sessionNumber;
      }
    }

    defaultData.lifetimeTokensSaved = sumTokens;
    defaultData.lifetimeCostSavedUsd = sumCost;
    defaultData.currentSessionNumber = maxSession;

    saveLifetimeData(workspaceRoot, defaultData);
  }

  return defaultData;
}

export function saveLifetimeData(workspaceRoot: string, data: LifetimeData): void {
  const cacheDir = path.join(workspaceRoot, CACHE_DIR);
  const filePath = path.join(cacheDir, LIFETIME_FILE);

  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Non-fatal if disk write fails
  }
}

export function clearLifetimeData(workspaceRoot: string): void {
  const cacheDir = path.join(workspaceRoot, CACHE_DIR);
  const filePath = path.join(cacheDir, LIFETIME_FILE);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Non-fatal
  }
}
