// Pure Node — renders a static inline SVG sparkline. The dashboard webview runs
// with scripts disabled, so charts must be server-rendered SVG (no Chart.js).
// Colors use `currentColor`/CSS custom properties so the chart follows the
// VS Code theme automatically.

export interface SparklineOptions {
  width?: number;
  height?: number;
  strokeVar?: string;   // CSS color for the line
  fillVar?: string;     // CSS color for the area fill
}

/**
 * Build an SVG line+area sparkline for a numeric series. A flat or single-point
 * series renders as a centered baseline rather than dividing by a zero range.
 */
export function sparklineSvg(values: number[], options: SparklineOptions = {}): string {
  const width = options.width ?? 160;
  const height = options.height ?? 36;
  const stroke = options.strokeVar ?? 'var(--vscode-charts-green, #4ec9b0)';
  const fill = options.fillVar ?? 'rgba(78, 201, 176, 0.12)';
  const pad = 3;

  if (values.length === 0) {
    return `<svg width="${width}" height="${height}" role="img" aria-label="no data"></svg>`;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;

  const points = values.map((v, i) => {
    const x = pad + (values.length > 1 ? i * stepX : innerW / 2);
    // Invert Y: larger values sit higher.
    const y = pad + innerH - ((v - min) / range) * innerH;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });

  const line = points.map(([x, y]) => `${x},${y}`).join(' ');
  const area = `${pad},${height - pad} ${line} ${pad + innerW},${height - pad}`;
  const [lastX, lastY] = points[points.length - 1];

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="trend sparkline" preserveAspectRatio="none">
  <polyline points="${area}" fill="${fill}" stroke="none"/>
  <polyline points="${line}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${lastX}" cy="${lastY}" r="2.2" fill="${stroke}"/>
</svg>`;
}
