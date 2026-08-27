import * as vscode from 'vscode';
import { exportExecutiveReport } from '../telemetry/export';

export async function exportTelemetryCommand(outputChannel: vscode.OutputChannel): Promise<void> {
  await exportExecutiveReport(outputChannel);
}
