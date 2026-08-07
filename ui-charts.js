/**
 * Charts drawn with DOM and SVG. No charting library: the three shapes
 * this site needs are cheap to build, and skipping the dependency keeps
 * the page under a hundred kilobytes.
 */
import { h, render } from './core-dom.js';
import { pct, num, masteryBand } from './core-format.js';

/** Horizontal bar list, e.g. accuracy by grammar rule. */
export function barChart(container, rows, { valueKey = 'value', labelKey = 'label', format = pct, tone } = {}) {
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 0.0001);

  render(container,
    h('div.bars', {}, rows.map((row) => {
      const value = Number(row[valueKey]) || 0;
      const width = `${Math.round((value / max) * 100)}%`;
      const rowTone = tone ? tone(value, row) : null;

      return h('div.bar-row', {},
        h('span.bar-row__label', { title: row[labelKey] }, row[labelKey]),
        h('div.progress', { role: 'img', 'aria-label': `${row[labelKey]}: ${format(value)}` },
          h('div.progress__fill', { style: { width }, dataset: rowTone ? { tone: rowTone } : {} })
        ),
        h('span.bar-row__value', {}, format(value))
      );
    }))
  );
}

/** Radial mastery dial. */
export function dial(value, { size = 96, stroke = 9, label = null } = {}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, value)));
  const band = masteryBand(value);

  return h('div.dial', { role: 'img', 'aria-label': `${label || 'Mastery'}: ${pct(value)}, ${band.label}` },
    h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' },
      svgEl('circle', {
        class: 'dial__track', cx: size / 2, cy: size / 2, r: radius, 'stroke-width': stroke
      }),
      svgEl('circle', {
        class: 'dial__value', cx: size / 2, cy: size / 2, r: radius, 'stroke-width': stroke,
        'stroke-dasharray': circumference, 'stroke-dashoffset': offset
      })
    ),
    h('span.dial__label', {}, pct(value))
  );
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** GitHub-style activity heat map for the streak calendar. */
export function heatmap(container, days, { weeks = 26 } = {}) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const cells = [];
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - weeks * 7 + 1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));   // back to Monday

  const peak = Math.max(...days.map((d) => d.answered), 1);

  for (let i = 0; i < weeks * 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = date.toISOString().slice(0, 10);
    const entry = byDay.get(key);
    const answered = entry?.answered || 0;
    const level = answered === 0 ? 0 : Math.min(4, Math.ceil((answered / peak) * 4));

    cells.push(h('div.heatmap__cell', {
      dataset: { level: String(level) },
      title: `${key}: ${answered} question${answered === 1 ? '' : 's'}`,
      role: 'img',
      'aria-label': `${key}, ${answered} questions`
    }));
  }

  render(container,
    h('div.heatmap', {}, cells),
    h('div.heatmap-legend.mt-2', {},
      h('span', {}, 'Less'),
      [0, 1, 2, 3, 4].map((level) => h('div.heatmap__cell', { dataset: { level: String(level) } })),
      h('span', {}, 'More')
    )
  );
}

/** Small sparkline of the last N session accuracies. */
export function sparkline(values, { width = 120, height = 32 } = {}) {
  if (!values.length) return h('span.subtle', {}, '—');
  const max = Math.max(...values, 1);
  const step = width / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => `${i * step},${height - (v / max) * height}`).join(' ');

  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
  svg.append(svgEl('polyline', {
    points, fill: 'none', stroke: 'var(--brand)', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  }));
  return svg;
}

export { num, pct };
