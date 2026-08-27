import * as vscode from 'vscode';
import { GuardrailConfig } from '../config';

export interface GuardrailEvent {
  type: 'max-retries' | 'max-file-reads' | 'max-files-per-task' | 'loop-detected';
  detail: string;
  timestamp: number;
  estimatedTokensSaved: number;
}

/**
 * In-memory tracker for guardrail events during a session.
 * Since Copilot doesn't expose hooks for agent loop detection,
 * this tracks guardrail trigger counts from the instruction rules
 * (the AI reports when it hits a limit) and from the semantic cache
 * call log (repeated identical queries signal a loop).
 */
export class GuardrailTracker {
  private events: GuardrailEvent[] = [];
  private sessionStart: number;

  constructor() {
    this.sessionStart = Date.now();
  }

  recordEvent(event: Omit<GuardrailEvent, 'timestamp'>): void {
    this.events.push({ ...event, timestamp: Date.now() });
  }

  getEvents(): GuardrailEvent[] {
    return [...this.events];
  }

  getStats(): { totalTriggers: number; estimatedTokensSaved: number } {
    let totalSaved = 0;
    for (const e of this.events) {
      totalSaved += e.estimatedTokensSaved;
    }
    return {
      totalTriggers: this.events.length,
      estimatedTokensSaved: totalSaved,
    };
  }

  reset(): void {
    this.events = [];
    this.sessionStart = Date.now();
  }
}

// Singleton for the current session
let tracker: GuardrailTracker | undefined;

export function getGuardrailTracker(): GuardrailTracker {
  if (!tracker) {
    tracker = new GuardrailTracker();
  }
  return tracker;
}

export function resetGuardrailTracker(): void {
  tracker = new GuardrailTracker();
}
