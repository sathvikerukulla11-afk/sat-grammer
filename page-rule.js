/** Single grammar rule: lesson, traps, your mastery, question counts. */
import { mountShell } from './ui-shell.js';
import { h, render, $ } from './core-dom.js';
import { num, pct, duration, masteryBand, relativeTime, titleCase } from './core-format.js';
import { getRuleBySlug, getRules } from './svc-questions.js';
import { isSignedIn } from './core-auth.js';
import { supabase } from './core-supabase.js';
import { getRuleCompletion } from './svc-progress.js';
import { dial } from './ui-charts.js';

await mountShell();

const slug = new URLSearchParams(location.search).get('slug');
if (!slug) location.replace('rules.html');

let rule;
try {
  rule = await getRuleBySlug(slug);
} catch {
  location.replace('404.html');
  throw new Error('not found');
}

document.title = `${rule.name} — SAT Grammar Lab`;
$('#rule-domain').textContent = rule.domain.name;
$('#rule-name').textContent = rule.name;
$('#rule-summary').textContent = rule.summary;
$('#practice-rule-btn').addEventListener('click', () => {
  location.assign(`practice.html?rule=${rule.slug}&start=1`);
});

/* ---- lesson -------------------------------------------------------------- */
render($('#rule-lesson'),
  rule.lesson_md
    ? renderMarkdown(rule.lesson_md)
    : h('p.muted', {}, 'A full written lesson for this rule is being written. ' +
                       'In the meantime, the practice questions each carry a complete explanation.'));

/* ---- traps --------------------------------------------------------------- */
render($('#rule-traps'),
  (rule.common_traps || []).length
    ? rule.common_traps.map((trap) => h('li', {}, trap))
    : h('li.muted', {}, 'No trap list recorded for this rule yet.'));

/* ---- question counts ------------------------------------------------------ */
const catalog = await getRules();
const counts = catalog.find((r) => r.id === rule.id);
render($('#rule-counts'), [
  ['Published', num(counts?.question_count ?? 0)],
  ['Concept difficulty', titleCase(counts?.typical_difficulty || 'medium')],
  ['Easy', num(counts?.easy_count ?? 0)],
  ['Medium', num(counts?.medium_count ?? 0)],
  ['Hard', num(counts?.hard_count ?? 0)],
  ['Expert', num(counts?.expert_count ?? 0)]
].flatMap(([term, value]) =>
  h('div.row-between', {}, h('dt.muted', {}, term), h('dd.tabular', {}, value))));

/* ---- your mastery --------------------------------------------------------- */
if (!isSignedIn()) {
  render($('#rule-mastery'),
    h('div.stack-sm.text-center', {},
      h('p.text-sm.muted', {}, 'Sign in to track your mastery of this rule.'),
      h('a.btn.btn-primary.btn-sm', { href: 'register.html' }, 'Create account')));
} else {
  const { data } = await supabase
    .from('user_rule_stats').select('*').eq('rule_id', rule.id).maybeSingle();

  const mastery = data?.mastery ?? 0;
  const band = masteryBand(mastery);

  render($('#rule-mastery'),
    h('div.stack-sm.center', {},
      dial(mastery, { size: 110, label: rule.name }),
      h('span.mastery-label.mt-2', { dataset: { band: band.band } }, band.label)));

  // Completion is a different question from mastery, and students
  // consistently conflate them, so both are shown side by side.
  const allCompletion = await getRuleCompletion().catch(() => []);
  const progress = allCompletion.find((row) => row.rule_id === rule.id);

  render($('#rule-stats'), [
    ['Attempted', num(data?.attempted ?? 0)],
    ['Accuracy', data?.attempted ? pct(data.correct / data.attempted) : '\u2014'],
    ['Average time', data?.attempted ? duration(data.total_time_ms / data.attempted, 'short') : '\u2014'],
    ['Questions seen', progress
      ? `${progress.seen} of ${progress.available} (${Math.round(progress.completion * 100)}%)`
      : '\u2014'],
    ['Last practiced', data?.last_practiced ? relativeTime(data.last_practiced) : 'Never']
  ].flatMap(([term, value]) =>
    h('div.row-between', {}, h('dt.muted', {}, term), h('dd', {}, value))));
}

/**
 * A deliberately small markdown subset — headings, bold, italics, code,
 * lists, paragraphs. Built as DOM nodes rather than an HTML string, so
 * lesson content cannot inject markup even if an author pastes some.
 */
function renderMarkdown(source) {
  const blocks = source.split(/\n{2,}/);
  return blocks.map((block) => {
    const trimmed = block.trim();
    if (/^### /.test(trimmed)) return h('h3', {}, inline(trimmed.slice(4)));
    if (/^## /.test(trimmed))  return h('h2', {}, inline(trimmed.slice(3)));
    if (/^> /.test(trimmed))   return h('blockquote', {}, inline(trimmed.replace(/^> ?/gm, '')));
    if (/^[-*] /.test(trimmed)) {
      return h('ul', {}, trimmed.split('\n').map((line) =>
        h('li', {}, inline(line.replace(/^[-*] /, '')))));
    }
    if (/^\d+\. /.test(trimmed)) {
      return h('ol', {}, trimmed.split('\n').map((line) =>
        h('li', {}, inline(line.replace(/^\d+\. /, '')))));
    }
    return h('p', {}, inline(trimmed));
  });
}

function inline(text) {
  const nodes = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('**'))     nodes.push(h('strong', {}, token.slice(2, -2)));
    else if (token.startsWith('`')) nodes.push(h('code', {}, token.slice(1, -1)));
    else                            nodes.push(h('em', {}, token.slice(1, -1)));
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
