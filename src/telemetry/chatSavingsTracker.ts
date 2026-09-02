import * as vscode from 'vscode';
import { spawnSync } from 'child_process';
import { getConfig } from '../core/config';
import { getActiveModel } from '../models/modelDetector';
import { readDiskEvents, recordDiskEvent, DiskSavingsEvent } from '../cache/eventLog';
import { isBinaryAvailable } from '../installer/installer';

export interface ChatSavingsEvent {
  id: string;
  timestamp: Date;
  directive: string;
  source: string;
  tokensSaved: number;
  costSavedUsd: number;
  details: string;
}

export interface ArchivedSession {
  sessionNumber: number;
  startedAt: Date;
  endedAt: Date;
  totalTokensSaved: number;
  totalCostSavedUsd: number;
  eventsCount: number;
  modelName: string;
  events: ChatSavingsEvent[];
}

class ChatSavingsTracker {
  private events: ChatSavingsEvent[] = [];
  private totalTokensSaved = 0;
  private totalCostSavedUsd = 0;
  private currentSessionNumber = 1;
  private sessionStartedAt: Date = new Date();
  private pastSessions: ArchivedSession[] = [];
  private changeListeners: Array<() => void> = [];
  private knownEventIds: Set<string> = new Set();
  private syncTimer?: NodeJS.Timeout;

  private lastRtkCommandCount = 0;
  private lastRtkSavedTokens = 0;
  private rtkInitialized = false;

  constructor() {
    this.sessionStartedAt = new Date();
    this.events = [];
    this.totalTokensSaved = 0;
    this.totalCostSavedUsd = 0;

    this.startDiskSync();
  }

  private startDiskSync(): void {
    // Poll disk & RTK events every 1.5s to capture live tool calls & command line proxy savings
    this.syncTimer = setInterval(() => {
      this.syncFromDisk();
    }, 1500);
  }

  public syncFromDisk(): void {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsPath) { return; }

    this.syncRtkSavings(wsPath);

    const diskEvents = readDiskEvents(wsPath);
    let newEventsAdded = false;

    for (const de of diskEvents) {
      if (!this.knownEventIds.has(de.id)) {
        const evTime = new Date(de.timestamp);
        // Ingest events that belong to current session
        if (evTime.getTime() >= this.sessionStartedAt.getTime() - 5000) {
          this.knownEventIds.add(de.id);
          const ev: ChatSavingsEvent = {
            id: de.id,
            timestamp: evTime,
            directive: de.directive,
            source: de.source,
            tokensSaved: de.tokensSaved,
            costSavedUsd: de.costSavedUsd,
            details: de.details,
          };
          this.events.unshift(ev);
          this.totalTokensSaved += ev.tokensSaved;
          this.totalCostSavedUsd += ev.costSavedUsd;
          newEventsAdded = true;
        }
      }
    }

    if (newEventsAdded) {
      if (this.events.length > 100) {
        this.events = this.events.slice(0, 100);
      }
      this.notifyListeners();
    }
  }

  private syncRtkSavings(wsPath: string): void {
    if (!isBinaryAvailable('rtk')) { return; }

    try {
      const res = spawnSync('rtk', ['gain', '-p', '-f', 'json'], {
        cwd: wsPath,
        encoding: 'utf-8',
        timeout: 2500,
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      if (!res.stdout) { return; }
      const data = JSON.parse(res.stdout);
      const summary = data?.summary;
      if (!summary || typeof summary.total_saved !== 'number') { return; }

      const totalSaved = summary.total_saved;
      const totalCmds = summary.total_commands || 0;
      const avgPct = summary.avg_savings_pct ? Math.round(summary.avg_savings_pct) : 87;

      if (!this.rtkInitialized) {
        this.rtkInitialized = true;
        this.lastRtkSavedTokens = totalSaved;
        this.lastRtkCommandCount = totalCmds;

        // Ingest workspace RTK command savings into active session
        if (totalSaved > 0) {
          this.recordEvent(
            'CLI Output Compression',
            'rtk CLI proxy',
            totalSaved,
            `Compressed ${totalCmds} shell command(s) (git/test/build) output by ~${avgPct}%`,
            false
          );
        }
        return;
      }

      const deltaTokens = totalSaved - this.lastRtkSavedTokens;
      const deltaCmds = totalCmds - this.lastRtkCommandCount;

      if (deltaTokens > 0 && deltaCmds > 0) {
        this.lastRtkSavedTokens = totalSaved;
        this.lastRtkCommandCount = totalCmds;

        this.recordEvent(
          'CLI Output Compression',
          'rtk CLI proxy',
          deltaTokens,
          `Compressed ${deltaCmds} shell command(s) (git/test/build) output by ~${avgPct}%`,
          true
        );
      }
    } catch {
      // Non-fatal if RTK check fails
    }
  }

  async recordEvent(
    directive: string,
    source: string,
    tokensSaved: number,
    details: string,
    showToast: boolean = false
  ): Promise<ChatSavingsEvent> {
    const config = getConfig();
    const activeModel = await getActiveModel();
    const pricing = config.pricing[activeModel.tier] || config.pricing.standard;
    const costSavedUsd = (tokensSaved / 1_000_000) * pricing.inputPerMillion;

    const event: ChatSavingsEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date(),
      directive,
      source,
      tokensSaved,
      costSavedUsd,
      details,
    };

    this.knownEventIds.add(event.id);
    this.events.unshift(event);
    if (this.events.length > 100) {
      this.events.pop();
    }

    this.totalTokensSaved += tokensSaved;
    this.totalCostSavedUsd += costSavedUsd;

    // Persist to disk for MCP server coherence
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsPath) {
      recordDiskEvent(wsPath, {
        directive,
        source,
        tokensSaved,
        costSavedUsd,
        details,
        sessionNumber: this.currentSessionNumber,
      });
    }

    this.notifyListeners();

    if (showToast) {
      const formattedCost = costSavedUsd < 0.0001 ? '<$0.0001' : `$${costSavedUsd.toFixed(4)}`;
      vscode.window.showInformationMessage(
        `🛡️ TokenShield: Saved ~${tokensSaved.toLocaleString()} tokens (${formattedCost}) via ${directive}!`
      );
    }

    return event;
  }

  async resetSession(): Promise<ArchivedSession> {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsPath && isBinaryAvailable('rtk')) {
      try {
        const res = spawnSync('rtk', ['gain', '-p', '-f', 'json'], {
          cwd: wsPath,
          encoding: 'utf-8',
          timeout: 2500,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (res.stdout) {
          const data = JSON.parse(res.stdout);
          if (data?.summary?.total_saved !== undefined) {
            this.lastRtkSavedTokens = data.summary.total_saved;
            this.lastRtkCommandCount = data.summary.total_commands || 0;
            this.rtkInitialized = true;
          }
        }
      } catch { /* ignore */ }
    }

    const activeModel = await getActiveModel();
    const archived: ArchivedSession = {
      sessionNumber: this.currentSessionNumber,
      startedAt: this.sessionStartedAt,
      endedAt: new Date(),
      totalTokensSaved: this.totalTokensSaved,
      totalCostSavedUsd: this.totalCostSavedUsd,
      eventsCount: this.events.length,
      modelName: activeModel.name,
      events: [...this.events],
    };

    this.pastSessions.unshift(archived);
    this.currentSessionNumber++;
    this.sessionStartedAt = new Date();
    this.totalTokensSaved = 0;
    this.totalCostSavedUsd = 0;
    this.events = [];
    this.knownEventIds.clear();

    this.notifyListeners();
    return archived;
  }

  getSessionNumber(): number {
    return this.currentSessionNumber;
  }

  getSessionStartedAt(): Date {
    return this.sessionStartedAt;
  }

  getPastSessions(): ArchivedSession[] {
    return this.pastSessions;
  }

  getTotalTokensSaved(): number {
    return this.totalTokensSaved;
  }

  getTotalCostSavedUsd(): number {
    return this.totalCostSavedUsd;
  }

  getRecentEvents(limit: number = 25): ChatSavingsEvent[] {
    return this.events.slice(0, limit);
  }

  private notifyListeners(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch { /* ignore */ }
    }
  }

  onDidChange(listener: () => void): vscode.Disposable {
    this.changeListeners.push(listener);
    return {
      dispose: () => {
        this.changeListeners = this.changeListeners.filter(l => l !== listener);
      },
    };
  }

  dispose(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
  }
}

export const chatSavingsTracker = new ChatSavingsTracker();
