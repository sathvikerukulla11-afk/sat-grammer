/** Display formatting. Locale-aware, never a raw number in the UI. */

const nf = new Intl.NumberFormat(undefined);
const pf = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });
const pf1 = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });

export const num = (n) => nf.format(Number(n) || 0);
export const pct = (n, precise = false) => (precise ? pf1 : pf).format(Number(n) || 0);

/** 125400 → "2:05"  |  4200 → "4.2s" */
export function duration(ms, style = 'clock') {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  if (style === 'short' && total < 60000) return `${(total / 1000).toFixed(1)}s`;

  const seconds = Math.round(total / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (style === 'long') {
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function relativeTime(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  const diff = Date.now() - then;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units = [
    ['year', 31536000000], ['month', 2592000000], ['week', 604800000],
    ['day', 86400000], ['hour', 3600000], ['minute', 60000]
  ];
  for (const [unit, msPerUnit] of units) {
    if (Math.abs(diff) >= msPerUnit) return rtf.format(-Math.round(diff / msPerUnit), unit);
  }
  return 'just now';
}

export const dateShort = (value) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';

export const dateLong = (value) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

/**
 * Date plus time of day, for deadlines where the hour matters.
 *
 * Rendered in the reader's own timezone. An access code stores an absolute
 * instant, so an admin in New York and a student in Los Angeles see the
 * same deadline written as two different local clock times — which is the
 * behaviour you want, not a bug to paper over.
 */
export const dateTimeShort = (value) =>
  value ? new Date(value).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }) : '—';

/** Mastery number → the band label and colour key the UI uses. */
export function masteryBand(mastery) {
  const m = Number(mastery) || 0;
  if (m === 0)    return { band: 'none',       label: 'Not started' };
  if (m < 0.4)    return { band: 'learning',   label: 'Learning' };
  if (m < 0.65)   return { band: 'developing', label: 'Developing' };
  if (m < 0.85)   return { band: 'proficient', label: 'Proficient' };
  return { band: 'mastered', label: 'Mastered' };
}

export const titleCase = (s) =>
  String(s || '').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Ordinal rank: 1 → "1st" */
export function ordinal(n) {
  const v = Number(n) || 0;
  const s = ['th', 'st', 'nd', 'rd'];
  const mod = v % 100;
  return v + (s[(mod - 20) % 10] || s[mod] || s[0]);
}
