export { getRoiEngine, EnterpriseRoiEngine } from './roiEngine';
export { exportExecutiveReport, exportTelemetry } from './export';

export interface RatingBand {
  excellentAtLeast: number;
  goodAtLeast: number;
  lowerIsBetter?: boolean;
}

export function rate(value: number, band: RatingBand): 'excellent' | 'good' | 'needs-improvement' {
  if (band.lowerIsBetter) {
    if (value <= band.excellentAtLeast) {
      return 'excellent';
    }
    if (value <= band.goodAtLeast) {
      return 'good';
    }
    return 'needs-improvement';
  }
  if (value >= band.excellentAtLeast) {
    return 'excellent';
  }
  if (value >= band.goodAtLeast) {
    return 'good';
  }
  return 'needs-improvement';
}
