import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { getConfig } from '../core/config';
import { getActiveModel } from '../models/modelDetector';
import { readDiskEvents, recordDiskEvent, clearDiskEvents, DiskSavingsEvent } from '../cache/eventLog';
import { readLifetimeData, saveLifetimeData, clearLifetimeData, ArchivedSessionRecord } from '../cache/lifetimeStore';
import { isBinaryAvailable } from '../installer/installer';

export interface ChatSavingsEvent {
  id: string;
  timestamp: Date;
  directive: string;
  source: string;
  tokensSaved: number;
  costSavedUsd: number;
  details: string;
  beforeTokens?: number;
  afterTokens?: number;
  reductionPercent?: number;
  modelName?: string;
  beforeContent?: string;
  afterContent?: string;
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
  private sessionTokensSaved = 0;
  private sessionCostSavedUsd = 0;
  private lifetimeTokensSaved = 0;
  private lifetimeCostSavedUsd = 0;
  private currentSessionNumber = 1;
  private sessionStartedAt: Date = new Date();
  private pastSessions: ArchivedSession[] = [];
  private changeListeners: Array<() => void> = [];
  private knownEventIds: Set<string> = new Set();
  private syncTimer?: NodeJS.Timeout;
  private initialized = false;

  private lastRtkCommandCount = 0;
  private lastRtkSavedTokens = 0;
  private lastRtkTotalInput = 0;
  private lastRtkTotalOutput = 0;
  private rtkInitialized = false;

  constructor() {
    this.sessionStartedAt = new Date();
    this.events = [];
    this.sessionTokensSaved = 0;
    this.sessionCostSavedUsd = 0;
    this.lifetimeTokensSaved = 0;
    this.lifetimeCostSavedUsd = 0;

    this.initFromDisk();
    this.startDiskSync();
  }

  private initFromDisk(): void {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsPath) { return; }

    try {
      const lifetime = readLifetimeData(wsPath);
      this.lifetimeTokensSaved = lifetime.lifetimeTokensSaved;
      this.lifetimeCostSavedUsd = lifetime.lifetimeCostSavedUsd;
      this.currentSessionNumber = lifetime.currentSessionNumber;
      this.pastSessions = (lifetime.pastSessions || []).map(ps => ({
        sessionNumber: ps.sessionNumber,
        startedAt: new Date(ps.startedAt),
        endedAt: new Date(ps.endedAt),
        totalTokensSaved: ps.totalTokensSaved,
        totalCostSavedUsd: ps.totalCostSavedUsd,
        eventsCount: ps.eventsCount,
        modelName: ps.modelName,
        events: (ps.events || []).map(e => ({
          id: e.id,
          timestamp: new Date(e.timestamp),
          directive: e.directive,
          source: e.source,
          tokensSaved: e.tokensSaved,
          costSavedUsd: e.costSavedUsd,
          details: e.details,
          beforeTokens: e.beforeTokens,
          afterTokens: e.afterTokens,
          reductionPercent: e.reductionPercent,
          modelName: e.modelName,
          beforeContent: e.beforeContent,
          afterContent: e.afterContent,
        })),
      }));

      // Ingest recent events from disk
      const diskEvents = readDiskEvents(wsPath);
      let diskSumTokens = 0;
      let diskSumCost = 0;
      for (const de of diskEvents) {
        this.knownEventIds.add(de.id);
        const evTime = new Date(de.timestamp);
        const ev: ChatSavingsEvent = {
          id: de.id,
          timestamp: evTime,
          directive: de.directive,
          source: de.source,
          tokensSaved: de.tokensSaved,
          costSavedUsd: de.costSavedUsd,
          details: de.details,
          beforeTokens: de.beforeTokens,
          afterTokens: de.afterTokens,
          reductionPercent: de.reductionPercent,
          modelName: de.modelName,
          beforeContent: de.beforeContent,
          afterContent: de.afterContent,
        };
        this.events.push(ev);
        diskSumTokens += de.tokensSaved;
        diskSumCost += de.costSavedUsd;

        // If recorded during this active IDE window session
        if (de.sessionNumber === this.currentSessionNumber && evTime.getTime() >= this.sessionStartedAt.getTime() - 60000) {
          this.sessionTokensSaved += de.tokensSaved;
          this.sessionCostSavedUsd += de.costSavedUsd;
        }
      }

      // Ensure lifetime totals cover disk events
      if (this.lifetimeTokensSaved < diskSumTokens) {
        this.lifetimeTokensSaved = diskSumTokens;
        this.lifetimeCostSavedUsd = diskSumCost;
        this.persistLifetime();
      }
      this.initialized = true;
    } catch {
      // Non-fatal
    }
  }

  private persistLifetime(): void {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsPath) { return; }

    const pastRecords: ArchivedSessionRecord[] = this.pastSessions.map(ps => ({
      sessionNumber: ps.sessionNumber,
      startedAt: ps.startedAt.toISOString(),
      endedAt: ps.endedAt.toISOString(),
      totalTokensSaved: ps.totalTokensSaved,
      totalCostSavedUsd: ps.totalCostSavedUsd,
      eventsCount: ps.eventsCount,
      modelName: ps.modelName,
      events: (ps.events || []).map(e => ({
        id: e.id,
        timestamp: e.timestamp.toISOString(),
        directive: e.directive,
        source: e.source,
        tokensSaved: e.tokensSaved,
        costSavedUsd: e.costSavedUsd,
        details: e.details,
        beforeTokens: e.beforeTokens,
        afterTokens: e.afterTokens,
        reductionPercent: e.reductionPercent,
        modelName: e.modelName,
        beforeContent: e.beforeContent,
        afterContent: e.afterContent,
      })),
    }));

    saveLifetimeData(wsPath, {
      version: 1,
      currentSessionNumber: this.currentSessionNumber,
      currentSessionStartedAt: this.sessionStartedAt.toISOString(),
      lifetimeTokensSaved: this.lifetimeTokensSaved,
      lifetimeCostSavedUsd: this.lifetimeCostSavedUsd,
      pastSessions: pastRecords,
    });
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

    if (!this.initialized) {
      this.initFromDisk();
    }

    this.syncRtkSavings(wsPath);
    this.syncHeadroomSavings();

    const diskEvents = readDiskEvents(wsPath);
    let newEventsAdded = false;

    for (const de of diskEvents) {
      if (!this.knownEventIds.has(de.id)) {
        const evTime = new Date(de.timestamp);

        // Deduplicate against existing in-memory events to prevent double counting
        const isDuplicate = this.events.some(
          e => e.id === de.id || (
            e.directive === de.directive &&
            e.source === de.source &&
            e.tokensSaved === de.tokensSaved &&
            Math.abs(e.timestamp.getTime() - evTime.getTime()) < 4000
          )
        );
        if (isDuplicate) {
          this.knownEventIds.add(de.id);
          continue;
        }

        this.knownEventIds.add(de.id);
        const ev: ChatSavingsEvent = {
          id: de.id,
          timestamp: evTime,
          directive: de.directive,
          source: de.source,
          tokensSaved: de.tokensSaved,
          costSavedUsd: de.costSavedUsd,
          details: de.details,
          beforeTokens: de.beforeTokens,
          afterTokens: de.afterTokens,
          reductionPercent: de.reductionPercent,
          modelName: de.modelName,
          beforeContent: de.beforeContent,
          afterContent: de.afterContent,
        };
        this.events.unshift(ev);

        // If recorded during this active window session
        if (de.sessionNumber === this.currentSessionNumber || evTime.getTime() >= this.sessionStartedAt.getTime() - 5000) {
          this.sessionTokensSaved += ev.tokensSaved;
          this.sessionCostSavedUsd += ev.costSavedUsd;
        }
        this.lifetimeTokensSaved += ev.tokensSaved;
        this.lifetimeCostSavedUsd += ev.costSavedUsd;
        newEventsAdded = true;
      }
    }

    if (newEventsAdded) {
      if (this.events.length > 100) {
        this.events = this.events.slice(0, 100);
      }
      this.persistLifetime();
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

      const totalInput = typeof summary.total_input === 'number' ? summary.total_input : 0;
      const totalOutput = typeof summary.total_output === 'number' ? summary.total_output : 0;
      const totalSaved = summary.total_saved;
      const totalCmds = summary.total_commands || 0;
      const avgPct = summary.avg_savings_pct ? Math.round(summary.avg_savings_pct) : 23;

      if (!this.rtkInitialized) {
        // Baseline RTK counts on session start so lifetime history is not dumped as a new session event
        this.rtkInitialized = true;
        this.lastRtkSavedTokens = totalSaved;
        this.lastRtkCommandCount = totalCmds;
        this.lastRtkTotalInput = totalInput;
        this.lastRtkTotalOutput = totalOutput;
        return;
      }

      const deltaTokens = totalSaved - this.lastRtkSavedTokens;
      const deltaCmds = totalCmds - this.lastRtkCommandCount;
      const rawDeltaInput = totalInput - this.lastRtkTotalInput;
      const rawDeltaOutput = totalOutput - this.lastRtkTotalOutput;

      if (deltaTokens > 0 && deltaCmds > 0) {
        this.lastRtkSavedTokens = totalSaved;
        this.lastRtkCommandCount = totalCmds;
        this.lastRtkTotalInput = totalInput;
        this.lastRtkTotalOutput = totalOutput;

        let recentCmd = 'rtk CLI proxy';
        try {
          const histRes = spawnSync('rtk', ['gain', '-p', '-H'], {
            cwd: wsPath,
            encoding: 'utf-8',
            timeout: 2000,
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          if (histRes.stdout) {
            const match = histRes.stdout.match(/\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\s]+\s+(rtk[^\n\r]+?)\s+(-?\d+%)\s+\((\d+)\)/);
            if (match && match[1]) {
              recentCmd = match[1].trim();
            }
          }
        } catch { /* fallback to default */ }

        const pct = avgPct > 0 && avgPct < 100 ? avgPct : 23;
        const deltaInput = rawDeltaInput > 0 ? rawDeltaInput : Math.max(deltaTokens + 1, Math.round(deltaTokens / (pct / 100)));
        const deltaOutput = rawDeltaOutput >= 0 ? rawDeltaOutput : Math.max(0, deltaInput - deltaTokens);

        this.recordEvent(
          'CLI Output Compression',
          recentCmd,
          deltaTokens,
          deltaCmds === 1
            ? `Compressed output of ${recentCmd} by ~${pct}%`
            : `Compressed ${deltaCmds} shell command(s) (${recentCmd}) output by ~${pct}%`,
          true,
          deltaInput,
          deltaOutput,
          pct
        );
      }
    } catch {
      // Non-fatal if RTK check fails
    }
  }

  private syncHeadroomSavings(): void {
    try {
      const ledgerPath = path.join(os.homedir(), '.headroom', 'savings_events.jsonl');
      if (!fs.existsSync(ledgerPath)) { return; }

      const content = fs.readFileSync(ledgerPath, 'utf-8');
      const lines = content.trim().split('\n');
      let newEventsAdded = false;

      for (const line of lines) {
        if (!line.trim()) { continue; }
        try {
          const entry = JSON.parse(line);
          const evTime = new Date(entry.ts);
          const eventId = `headroom-${entry.ts}-${entry.saved}`;

          if (!this.knownEventIds.has(eventId)) {
            this.knownEventIds.add(eventId);
            const savedTokens = typeof entry.saved === 'number' ? entry.saved : 0;
            const costUsd = typeof entry.cost_usd === 'number' ? entry.cost_usd : 0;
            const source = entry.client || entry.source || 'Headroom MCP';
            const before = typeof entry.before === 'number' ? entry.before : undefined;
            const after = typeof entry.after === 'number' ? entry.after : undefined;
            const pct = before && after && before > 0 ? Math.round(((before - after) / before) * 100) : undefined;
            const details = before !== undefined && after !== undefined
              ? `Lossless compression (-${pct}% tokens: ${before} ➔ ${after} tok)`
              : `Saved ${savedTokens} tokens via Headroom`;

            const ev: ChatSavingsEvent = {
              id: eventId,
              timestamp: evTime,
              directive: 'Headroom Reversible CCR',
              source,
              tokensSaved: savedTokens,
              costSavedUsd: costUsd,
              details,
              beforeTokens: before,
              afterTokens: after,
              reductionPercent: pct,
            };
            this.events.unshift(ev);

            // Ingest to current window session if recorded after session start
            if (evTime.getTime() >= this.sessionStartedAt.getTime() - 5000) {
              this.sessionTokensSaved += ev.tokensSaved;
              this.sessionCostSavedUsd += ev.costSavedUsd;
            }
            this.lifetimeTokensSaved += ev.tokensSaved;
            this.lifetimeCostSavedUsd += ev.costSavedUsd;
            newEventsAdded = true;
          }
        } catch {
          // ignore malformed line
        }
      }

      if (newEventsAdded) {
        if (this.events.length > 100) {
          this.events = this.events.slice(0, 100);
        }
        this.persistLifetime();
        this.notifyListeners();
      }
    } catch {
      // Non-fatal if reading ledger fails
    }
  }

  async recordEvent(
    directive: string,
    source: string,
    tokensSaved: number,
    details: string,
    showToast: boolean = false,
    beforeTokens?: number,
    afterTokens?: number,
    reductionPercent?: number,
    beforeContent?: string,
    afterContent?: string
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
      beforeTokens,
      afterTokens,
      reductionPercent,
      modelName: activeModel.name,
      beforeContent,
      afterContent,
    };

    this.knownEventIds.add(event.id);
    this.events.unshift(event);
    if (this.events.length > 100) {
      this.events.pop();
    }

    this.sessionTokensSaved += tokensSaved;
    this.sessionCostSavedUsd += costSavedUsd;
    this.lifetimeTokensSaved += tokensSaved;
    this.lifetimeCostSavedUsd += costSavedUsd;

    // Persist to disk for MCP server coherence with aligned ID
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsPath) {
      recordDiskEvent(wsPath, {
        id: event.id,
        timestamp: event.timestamp.toISOString(),
        directive,
        source,
        tokensSaved,
        costSavedUsd,
        details,
        sessionNumber: this.currentSessionNumber,
        beforeTokens,
        afterTokens,
        reductionPercent,
        modelName: activeModel.name,
        beforeContent,
        afterContent,
      });
      this.persistLifetime();
    }

    this.notifyListeners();

    if (showToast) {
      const formattedCost = costSavedUsd < 0.0001 ? '<$0.0001' : `$${costSavedUsd.toFixed(4)}`;
      vscode.window.showInformationMessage(
        `🛡️ TokenSculpt: Saved ~${tokensSaved.toLocaleString()} tokens (${formattedCost}) via ${directive}!`
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
    const sessionEvents = this.events.filter(e => e.timestamp >= this.sessionStartedAt);
    const archived: ArchivedSession = {
      sessionNumber: this.currentSessionNumber,
      startedAt: this.sessionStartedAt,
      endedAt: new Date(),
      totalTokensSaved: this.sessionTokensSaved,
      totalCostSavedUsd: this.sessionCostSavedUsd,
      eventsCount: sessionEvents.length,
      modelName: activeModel.name,
      events: [...sessionEvents],
    };

    this.pastSessions.unshift(archived);
    this.currentSessionNumber++;
    this.sessionStartedAt = new Date();
    this.sessionTokensSaved = 0;
    this.sessionCostSavedUsd = 0;

    this.persistLifetime();
    this.notifyListeners();
    return archived;
  }

  async resetAllData(): Promise<void> {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsPath) {
      clearDiskEvents(wsPath);
      clearLifetimeData(wsPath);
      try {
        const callLogPath = path.join(wsPath, '.aicache', 'call-log.json');
        if (fs.existsSync(callLogPath)) {
          fs.unlinkSync(callLogPath);
        }
      } catch { /* ignore non-fatal filesystem error */ }
    }

    try {
      const headroomLedger = path.join(os.homedir(), '.headroom', 'savings_events.jsonl');
      if (fs.existsSync(headroomLedger)) {
        fs.writeFileSync(headroomLedger, '', 'utf-8');
      }
    } catch { /* ignore non-fatal filesystem error */ }

    this.events = [];
    this.knownEventIds.clear();
    this.pastSessions = [];
    this.currentSessionNumber = 1;
    this.sessionStartedAt = new Date();
    this.sessionTokensSaved = 0;
    this.sessionCostSavedUsd = 0;
    this.lifetimeTokensSaved = 0;
    this.lifetimeCostSavedUsd = 0;
    this.lastRtkCommandCount = 0;
    this.lastRtkSavedTokens = 0;
    this.rtkInitialized = false;

    this.persistLifetime();
    this.notifyListeners();
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

  getSessionTokensSaved(): number {
    return this.sessionTokensSaved;
  }

  getSessionCostSavedUsd(): number {
    return this.sessionCostSavedUsd;
  }

  getLifetimeTokensSaved(): number {
    return this.lifetimeTokensSaved;
  }

  getLifetimeCostSavedUsd(): number {
    return this.lifetimeCostSavedUsd;
  }

  // Returns current session tokens for status bar and widgets
  getTotalTokensSaved(): number {
    return this.sessionTokensSaved;
  }

  getTotalCostSavedUsd(): number {
    return this.sessionCostSavedUsd;
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
