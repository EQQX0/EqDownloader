const DASH = '—';

/** Whole-number percent; missing or non-finite values read as 0%. */
export function formatPercent(p: number | null | undefined): string {
  if (typeof p !== 'number' || !Number.isFinite(p)) return '0%';
  return `${Math.round(Math.min(100, Math.max(0, p)))}%`;
}

export function formatSpeed(bps: number | null | undefined): string {
  if (typeof bps !== 'number' || !Number.isFinite(bps) || bps < 0) return DASH;
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = bps;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return `${u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

export function formatEta(sec: number | null | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return DASH;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}
