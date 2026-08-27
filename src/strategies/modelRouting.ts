import * as vscode from 'vscode';
import { LIGHTWEIGHT_TASK_PATTERNS, FULLPOWER_TASK_PATTERNS } from '../constants';

export type TaskComplexity = 'lightweight' | 'full-power' | 'unknown';

export interface RoutingEvent {
  query: string;
  classification: TaskComplexity;
  suggestedModel: string | null;
  timestamp: number;
  userAccepted: boolean | null;
}

/**
 * Classify a user query/prompt into task complexity.
 * Returns 'lightweight' for simple tasks that could use a cheaper model,
 * 'full-power' for complex tasks, or 'unknown' if can't determine.
 */
export function classifyTask(query: string): TaskComplexity {
  const lower = query.toLowerCase();

  // Check full-power patterns first (take priority)
  for (const pattern of FULLPOWER_TASK_PATTERNS) {
    if (lower.includes(pattern)) {
      return 'full-power';
    }
  }

  // Check lightweight patterns
  for (const pattern of LIGHTWEIGHT_TASK_PATTERNS) {
    if (lower.includes(pattern)) {
      return 'lightweight';
    }
  }

  // Short queries are often lightweight
  const wordCount = query.trim().split(/\s+/).length;
  if (wordCount <= 5) {
    return 'lightweight';
  }

  return 'unknown';
}

/**
 * In-memory log of model routing events for the current session.
 */
export class ModelRoutingTracker {
  private events: RoutingEvent[] = [];

  recordClassification(query: string, classification: TaskComplexity): void {
    const suggestedModel = classification === 'lightweight' ? 'gpt-4o-mini / Haiku' : null;
    this.events.push({
      query: query.slice(0, 100), // truncate for privacy
      classification,
      suggestedModel,
      timestamp: Date.now(),
      userAccepted: null,
    });
  }

  getEvents(): RoutingEvent[] {
    return [...this.events];
  }

  getStats(): {
    totalClassified: number;
    lightweight: number;
    fullPower: number;
    unknown: number;
    estimatedCostSaved: number;
  } {
    let lightweight = 0;
    let fullPower = 0;
    let unknown = 0;

    for (const e of this.events) {
      switch (e.classification) {
        case 'lightweight': lightweight++; break;
        case 'full-power': fullPower++; break;
        default: unknown++; break;
      }
    }

    // Estimate: lightweight tasks save ~$0.01 each if routed to a cheaper model
    const estimatedCostSaved = lightweight * 0.01;

    return {
      totalClassified: this.events.length,
      lightweight,
      fullPower,
      unknown,
      estimatedCostSaved,
    };
  }

  reset(): void {
    this.events = [];
  }
}

// Singleton
let routingTracker: ModelRoutingTracker | undefined;

export function getModelRoutingTracker(): ModelRoutingTracker {
  if (!routingTracker) {
    routingTracker = new ModelRoutingTracker();
  }
  return routingTracker;
}

/**
 * Show a suggestion notification when a lightweight task is detected.
 * Called from the extension when appropriate hooks are available.
 */
export async function suggestLighterModel(query: string): Promise<void> {
  const classification = classifyTask(query);
  const tracker = getModelRoutingTracker();
  tracker.recordClassification(query, classification);

  if (classification === 'lightweight') {
    const selection = await vscode.window.showInformationMessage(
      '💡 This looks like a simple task. Consider using a lighter model (e.g., GPT-4o-mini) to save tokens.',
      'Dismiss',
      'Don\'t show again',
    );

    if (selection === 'Don\'t show again') {
      const config = vscode.workspace.getConfiguration('aiTokenOptimizer');
      await config.update('activeStrategies.smartModelRouting', false, vscode.ConfigurationTarget.Workspace);
    }
  }
}
