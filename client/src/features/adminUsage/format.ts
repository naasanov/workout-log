// Formatting helpers local to the admin usage dashboard.

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Per-turn cost is usually a few cents, so it gets more precision than a
// headline total does.
const usdPreciseFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

export function formatUsdPrecise(value: number): string {
  return usdPreciseFormatter.format(value);
}

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatCompactNumber(value: number): string {
  return compactFormatter.format(value);
}

export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatAverage(total: number, count: number): string {
  if (count <= 0) return '—';
  return (total / count).toFixed(1);
}
