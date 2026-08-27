import * as vscode from 'vscode';
import { getConfig } from '../core/config';
import { getActiveModel } from '../models/modelDetector';

export interface ChatSavingsEvent {
  id: string;
  timestamp: Date;
  directive: string;
  source: string;
  tokensSaved: number;
  costSavedUsd: number;
  details: string;
}

class ChatSavingsTracker {
  private events: ChatSavingsEvent[] = [];
  private totalTokensSaved = 0;
  private totalCostSavedUsd = 0;
  private changeListeners: Array<() => void> = [];

  constructor() {
    // Initial dummy baseline or load from session
    this.totalTokensSaved = 2500; // Baseline from CAP-7 exclusions
    this.totalCostSavedUsd = 0.0075;
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

    this.events.unshift(event);
    if (this.events.length > 50) {
      this.events.pop();
    }

    this.totalTokensSaved += tokensSaved;
    this.totalCostSavedUsd += costSavedUsd;

    // Notify listeners (status bar widget)
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch { /* ignore */ }
    }

    if (showToast) {
      const formattedCost = costSavedUsd < 0.0001 ? '<$0.0001' : `$${costSavedUsd.toFixed(4)}`;
      vscode.window.showInformationMessage(
        `🛡️ TokenShield: Saved ~${tokensSaved.toLocaleString()} tokens (${formattedCost}) via ${directive}!`
      );
    }

    return event;
  }

  getTotalTokensSaved(): number {
    return this.totalTokensSaved;
  }

  getTotalCostSavedUsd(): number {
    return this.totalCostSavedUsd;
  }

  getRecentEvents(limit: number = 10): ChatSavingsEvent[] {
    return this.events.slice(0, limit);
  }

  onDidChange(listener: () => void): vscode.Disposable {
    this.changeListeners.push(listener);
    return {
      dispose: () => {
        this.changeListeners = this.changeListeners.filter(l => l !== listener);
      },
    };
  }
}

export const chatSavingsTracker = new ChatSavingsTracker();
