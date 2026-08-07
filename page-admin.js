/**
 * Admin panel: authoring, review queue, coverage, moderation, bulk import.
 * Every write here still passes through RLS — this UI is a convenience
 * over the same API a student's browser has, not a privileged channel.
 */
import { mountShell } from './ui-shell.js';
import { requireAuth, isAdmin } from './core-auth.js';
import { h, render, $, $$ } from './core-dom.js';
import { num, pct, relativeTime, titleCase, dateShort, dateTimeShort } from './core-format.js';
import { getRules } from './svc-questions.js';
import * as admin from './svc-admin.js';
import { listFeedback, setFeedbackState } from './svc-feedback.js';
import { toastSuccess, toastError, toastWarning } from './ui-toast.js';
import { openModal, confirmDialog } from './ui-modal.js';

await mountShell();
if (!await requireAuth({ staffOnly: true })) throw new Error('redirecting');

const rules = await getRules();

/* ---- admin-only sections --------------------------------------------------
 * The dashboard as a whole is staff-accessible, because authors and
 * moderators need the question bank. Premium access is narrower: it moves
 * money and entitlements, so it is admin-only.
 *
 * Hiding the tab is courtesy, not security. Every premium RPC re-checks
 * is_admin() in SQL, so a moderator who unhides this by hand gets a
 * permission error from Postgres rather than a working panel.
 */
if (!isAdmin()) {
  document.querySelector('[data-panel="premium"]')?.remove();
  document.getElementById('panel-premium')?.remove();
}

/* ---- panel switching ------------------------------------------------------ */
const panels = $$('.admin-panel');
$$('.sidebar .nav__link').forEach((link) => link.addEventListener('click', () => {
  const target = link.dataset.panel;
  $$('.sidebar .nav__link').forEach((l) =>
    l.setAttribute('aria-current', l === link ? 'page' : 'false'));
  panels.forEach((panel) => { panel.hidden = panel.id !== `panel-${target}`; });
  LOADERS[target]?.();
}));

/* ================================================================== */
/* Questions list                                                     */
/* ================================================================== */

/**
 * Keyset pagination.
 *
 * `cursors` is a stack: index N holds the cursor that opens page N, so
 * "Previous" is a pop rather than a re-query from the beginning. `null`
 * at index 0 means "the newest rows".
 */
const listState = {
  pageIndex: 0,
  pageSize: 25,
  cursors: [null],
  nextCursor: null,
  selected: new Set(),
  lastRows: []
};

function currentFilters() {
  return {
    search: $('#q-search').value.trim(),
    status: $('#q-status').value || null,
    ruleId: $('#q-rule').value ? Number($('#q-rule').value) : null,
    difficulty: $('#q-difficulty').value || null,
    minQuality: $('#q-quality').value ? Number($('#q-quality').value) : null,
    includeDeleted: $('#q-deleted').checked
  };
}

['#q-rule', '#e-rule'].forEach((selector) => {
  const select = $(selector);
  rules.forEach((rule) => select.append(h('option', { value: String(rule.id) }, rule.name)));
});

['#q-search', '#q-status', '#q-rule', '#q-difficulty', '#q-quality', '#q-deleted']
  .forEach((selector) => {
    let timer;
    $(selector).addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Any filter change invalidates the cursor stack.
        listState.pageIndex = 0;
        listState.cursors = [null];
        loadQuestions();
      }, 300);
    });
  });

$('#prev-page').addEventListener('click', () => {
  if (listState.pageIndex === 0) return;
  listState.pageIndex--;
  listState.cursors.length = listState.pageIndex + 1;
  loadQuestions();
});

$('#next-page').addEventListener('click', () => {
  if (!listState.nextCursor) return;
  listState.pageIndex++;
  listState.cursors[listState.pageIndex] = listState.nextCursor;
  loadQuestions();
});

async function loadQuestions() {
  const result = await admin.searchQuestions({
    ...currentFilters(),
    limit: listState.pageSize,
    cursor: listState.cursors[listState.pageIndex]
  });

  listState.nextCursor = result.next_cursor;
  listState.lastRows = result.rows;

  const from = listState.pageIndex * listState.pageSize + 1;
  const to = from + result.rows.length - 1;
  $('#q-count').textContent = result.rows.length
    ? `${result.estimated ? 'about ' : ''}${num(result.total)} questions \u00b7 showing ${from}\u2013${to}`
    : 'No questions match those filters.';

  $('#prev-page').disabled = listState.pageIndex === 0;
  $('#next-page').disabled = !result.next_cursor;

  render($('#questions-table'), result.rows.map(questionRow));
}

function questionRow(row) {
  const deleted = Boolean(row.deleted_at);

  return h('tr', { style: deleted ? { opacity: '0.55' } : {} },
    h('td', {}, h('input', {
      type: 'checkbox', 'aria-label': `Select ${row.public_id}`,
      checked: listState.selected.has(row.id),
      onchange: (e) => {
        e.target.checked ? listState.selected.add(row.id) : listState.selected.delete(row.id);
        updateBulkBar();
      }
    })),
    h('td.wrap', {},
      deleted ? h('span.badge.badge-danger', {}, 'Deleted') : null,
      deleted ? ' ' : null,
      truncate(row.passage, 80)),
    h('td', {}, row.rule?.name || '\u2014'),
    h('td', {}, h('span.badge', { dataset: { difficulty: row.difficulty } }, row.difficulty)),
    h('td', {}, h('span.row', {},
      h('span.status-dot', { dataset: { status: row.status } }),
      titleCase(row.status))),
    h('td.num', {}, qualityStars(row.quality_rating, row.quality_votes)),
    h('td.num', {}, num(row.times_served)),
    h('td.num', {}, row.p_value != null ? pct(row.p_value) : '\u2014'),
    h('td', {}, dateShort(row.created_at)),
    h('td', {}, h('div.row', {},
      h('button.btn.btn-sm.btn-ghost', {
        type: 'button', onclick: () => editQuestion(row.id)
      }, 'Edit'),
      deleted
        ? h('button.btn.btn-sm.btn-ghost', {
            type: 'button',
            async onclick() {
              await admin.restoreQuestion(row.id);
              toastSuccess('Restored as a draft.');
              await loadQuestions();
            }
          }, 'Restore')
        : h('button.btn.btn-sm.btn-ghost', {
            type: 'button',
            style: { color: 'var(--danger)' },
            onclick: () => confirmDelete([row.id], row.passage)
          }, 'Delete'))));
}

/** Mean rating as stars, with the raw numbers in the accessible label. */
function qualityStars(rating, votes) {
  if (rating == null) return h('span.subtle', { title: 'Not yet reviewed' }, '\u2014');
  const rounded = Math.round(rating);
  return h('span', {
    title: `${rating} from ${votes} review${votes === 1 ? '' : 's'}`,
    'aria-label': `Quality ${rating} out of 5, from ${votes} reviews`
  }, '\u2605'.repeat(rounded) + '\u2606'.repeat(5 - rounded));
}

/**
 * Deletion is destructive enough to warrant naming the consequence rather
 * than a generic "are you sure". The server decides soft versus hard; we
 * tell the user which it will be before they commit.
 */
async function confirmDelete(ids, sample = null) {
  const reasonInput = h('input.input', {
    type: 'text', placeholder: 'Reason (recorded in the audit log)'
  });

  const confirmed = await new Promise((resolve) => {
    openModal({
      title: ids.length === 1 ? 'Delete this question?' : `Delete ${ids.length} questions?`,
      body: h('div.stack', {},
        sample ? h('p.text-sm.muted', { style: { fontFamily: 'var(--font-serif)' } },
                   truncate(sample, 160)) : null,
        h('div.alert.alert-info', {}, h('div', {},
          h('p', {}, h('strong', {}, 'Questions students have answered are retired, not erased. '),
            'Their attempt history stays intact and still explains itself. Drafts nobody has ' +
            'seen are removed outright.'),
          h('p.mt-2', {}, 'Either way this is reversible from the ',
            h('em', {}, 'Show deleted'), ' filter.'))),
        h('div.field', {}, reasonInput)),
      actions: [
        { label: 'Cancel', value: false },
        { label: 'Delete', variant: 'btn-danger', value: true }
      ],
      onClose: (value) => resolve(Boolean(value))
    });
  });
  if (!confirmed) return;

  try {
    const report = await admin.deleteQuestions(ids, reasonInput.value || null);
    listState.selected.clear();
    updateBulkBar();
    await loadQuestions();

    const parts = [];
    if (report.hard) parts.push(`${report.hard} removed`);
    if (report.soft) parts.push(`${report.soft} retired (attempt history preserved)`);
    if (report.failed.length) parts.push(`${report.failed.length} failed`);

    report.failed.length
      ? toastWarning(parts.join(' \u00b7 '))
      : toastSuccess(parts.join(' \u00b7 ') || 'Nothing to delete.');
  } catch (err) {
    toastError(err.message);
  }
}

function updateBulkBar() {
  const count = listState.selected.size;
  $('#bulk-actions').hidden = count === 0;
  $('#bulk-count').textContent = `${count} selected`;
}

$('#select-all').addEventListener('change', (event) => {
  $$('#questions-table input[type="checkbox"]').forEach((box) => {
    box.checked = event.target.checked;
    box.dispatchEvent(new Event('change'));
  });
});

$('#bulk-delete').addEventListener('click', () => {
  if (listState.selected.size) confirmDelete([...listState.selected]);
});

$$('[data-bulk]').forEach((button) => button.addEventListener('click', async () => {
  const status = button.dataset.bulk;
  const confirmed = await confirmDialog({
    title: `Set ${listState.selected.size} questions to ${titleCase(status)}?`,
    message: status === 'published'
      ? 'Publishing validates that each question has four choices and exactly one correct answer.'
      : 'This changes their visibility to students.',
    confirmLabel: 'Apply'
  });
  if (!confirmed) return;

  try {
    await admin.bulkSetStatus([...listState.selected], status);
    listState.selected.clear();
    updateBulkBar();
    await admin.refreshRuleCounts();
    await loadQuestions();
    toastSuccess('Status updated.');
  } catch (err) {
    toastError(err.message);
  }
}));

/* ================================================================== */
/* Editor                                                             */
/* ================================================================== */

let editing = null;

function blankChoice() { return { body: '', rationale: '' }; }

function drawChoiceEditors(choices, correctIndex) {
  render($('#choice-editors'), choices.map((choice, index) =>
    h('div.choice-editor', { dataset: { correct: String(index === correctIndex) } },
      h('label.center', {},
        h('input', {
          type: 'radio', name: 'correct', value: String(index),
          checked: index === correctIndex,
          'aria-label': `Mark choice ${'ABCD'[index]} correct`,
          onchange: () => {
            $$('#choice-editors .choice-editor').forEach((el, i) => {
              el.dataset.correct = String(i === index);
            });
          }
        }),
        h('span.text-xs.mt-1', {}, 'ABCD'[index])),
      h('div.stack-sm', {},
        h('input.input', {
          type: 'text', value: choice.body,
          placeholder: `Choice ${'ABCD'[index]} text`,
          'aria-label': `Choice ${'ABCD'[index]} text`,
          dataset: { field: 'body', index: String(index) }
        }),
        h('textarea.textarea', {
          rows: 2, value: choice.rationale,
          placeholder: 'Why is this right or wrong?',
          'aria-label': `Choice ${'ABCD'[index]} rationale`,
          dataset: { field: 'rationale', index: String(index) }
        })))));
}

function readEditor() {
  const choices = [0, 1, 2, 3].map((index) => ({
    body: $(`#choice-editors [data-field="body"][data-index="${index}"]`).value,
    rationale: $(`#choice-editors [data-field="rationale"][data-index="${index}"]`).value
  }));
  const correctInput = $('#choice-editors input[name="correct"]:checked');

  return {
    id: editing?.id || null,
    tags: $('#e-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    rule_id: Number($('#e-rule').value),
    difficulty: $('#e-difficulty').value,
    skill: $('#e-skill').value,
    passage: $('#e-passage').value,
    stem: $('#e-stem').value,
    explanation: $('#e-explanation').value,
    source_note: $('#e-source').value,
    choices,
    correct_index: correctInput ? Number(correctInput.value) : null
  };
}

function openEditor(question = null) {
  editing = question;
  $$('.sidebar .nav__link').forEach((l) =>
    l.setAttribute('aria-current', l.dataset.panel === 'editor' ? 'page' : 'false'));
  panels.forEach((panel) => { panel.hidden = panel.id !== 'panel-editor'; });

  $('#e-rule').value = question?.rule_id || rules[0]?.id || '';
  $('#e-difficulty').value = question?.difficulty || 'medium';
  $('#e-skill').value = question?.skill || '';
  $('#e-passage').value = question?.passage || '';
  $('#e-stem').value = question?.stem || '';
  $('#e-explanation').value = question?.explanation || '';
  $('#e-source').value = question?.source_note || '';
  $('#e-tags').value = '';
  $('#delete-question-btn').hidden = !question;

  // Quality review is only meaningful once the question exists.
  $('#quality-field').hidden = !question;
  if (question) {
    loadQuestionTags(question.id);
    drawQualityStars(question.quality_rating);
    $('#quality-summary').textContent = question.quality_votes
      ? `Mean ${question.quality_rating} from ${question.quality_votes} review(s).`
      : 'Nobody has rated this question yet.';
    $('#e-quality-notes').value = '';
  }

  const choices = question?.choices?.length
    ? [...question.choices].sort((a, b) => a.label.localeCompare(b.label))
        .map((c) => ({ body: c.body, rationale: c.rationale }))
    : [blankChoice(), blankChoice(), blankChoice(), blankChoice()];

  const correctIndex = question?.choices
    ? [...question.choices].sort((a, b) => a.label.localeCompare(b.label))
        .findIndex((c) => c.is_correct)
    : 0;

  drawChoiceEditors(choices, correctIndex);
}

$('#new-question-btn').addEventListener('click', () => openEditor(null));

async function editQuestion(id) {
  try {
    openEditor(await admin.getQuestionForEdit(id));
  } catch (err) {
    toastError(err.message);
  }
}

$('#editor-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = event.submitter?.dataset.status || 'draft';
  const draft = { ...readEditor(), status };

  const problems = admin.validateDraft(draft);
  if (problems.length) return toastError(problems[0], { title: 'Not ready to save' });

  try {
    const saved = await admin.saveQuestion(draft);
    editing = saved;
    toastSuccess(`Saved as ${titleCase(saved.status)} (${saved.public_id}).`);
    await loadQuestions();
  } catch (err) {
    toastError(err.message, { title: 'Save failed' });
  }
});

$('#preview-btn').addEventListener('click', () => {
  const draft = readEditor();
  const [before, after] = draft.passage.split(/_{3,}/);

  openModal({
    title: 'Student preview',
    size: '720px',
    body: h('article.question', {},
      h('div.question__body', {},
        h('div.passage', {}, before || draft.passage,
          after !== undefined ? h('span.blank', {}, '    ') : null, after || ''),
        h('p.question__stem', {}, draft.stem || 'Which choice completes the text?'),
        h('div.choices', {}, draft.choices.map((choice, index) =>
          h('div.choice', { dataset: index === draft.correct_index ? { state: 'correct' } : {} },
            h('span.choice__key', {}, 'ABCD'[index]),
            h('span.choice__body', {}, choice.body || '(empty)')))))),
    actions: [{ label: 'Close', value: true }]
  });
});

/* ================================================================== */
/* Coverage / reports / calibration / users / import                   */
/* ================================================================== */

async function loadCoverage() {
  const rows = await admin.getCoverage();
  const byRule = new Map();
  for (const row of rows) {
    const entry = byRule.get(row.rule_id) || { name: row.name, slug: row.slug, cells: {}, draft: 0 };
    entry.cells[row.difficulty] = row.published;
    entry.draft += row.draft + row.in_review;
    byRule.set(row.rule_id, entry);
  }

  render($('#coverage-table'), [...byRule.values()].map((rule) => {
    const total = ['easy', 'medium', 'hard', 'expert']
      .reduce((sum, level) => sum + (rule.cells[level] || 0), 0);
    return h('tr', {},
      h('th', { scope: 'row' }, rule.name),
      ...['easy', 'medium', 'hard', 'expert'].map((level) => {
        const count = rule.cells[level] || 0;
        return h('td.num', {
          style: count === 0 ? { color: 'var(--danger)', fontWeight: '600' } : {}
        }, num(count));
      }),
      h('td.num', { style: { fontWeight: '600' } }, num(total)),
      h('td.num.muted', {}, num(rule.draft)));
  }));
}

async function loadReports() {
  const reports = await admin.listReports('open');
  if (!reports.length) {
    render($('#reports-list'), h('div.empty', {},
      h('p.empty__title', {}, 'No open reports'),
      h('p', {}, 'Student-reported problems land here.')));
    return;
  }

  render($('#reports-list'), h('div.stack', {}, reports.map((report) =>
    h('article.card', {},
      h('div.row-wrap', {},
        h('span.badge.badge-warning', {}, titleCase(report.reason)),
        h('span.text-sm.muted', {}, `by @${report.reporter?.username || 'deleted user'}`),
        h('div.spacer'),
        h('span.text-xs.subtle', {}, relativeTime(report.created_at))),
      h('p.mt-3', { style: { fontFamily: 'var(--font-serif)' } },
        truncate(report.question?.passage || '', 200)),
      report.detail ? h('p.text-sm.mt-2', {}, `“${report.detail}”`) : null,
      h('div.row-wrap.mt-4', {},
        h('button.btn.btn-sm', {
          type: 'button', onclick: () => editQuestion(report.question.id)
        }, 'Open in editor'),
        h('button.btn.btn-sm.btn-success', {
          type: 'button',
          async onclick(event) {
            await admin.resolveReport(report.id, 'resolved');
            event.currentTarget.closest('article').remove();
            toastSuccess('Marked resolved.');
          }
        }, 'Resolve'),
        h('button.btn.btn-sm.btn-ghost', {
          type: 'button',
          async onclick(event) {
            await admin.resolveReport(report.id, 'dismissed');
            event.currentTarget.closest('article').remove();
          }
        }, 'Dismiss'))))));
}

async function loadCalibration() {
  const rows = await admin.getMiscalibrated();
  render($('#calibration-table'),
    rows.length
      ? rows.map((row) => {
          const suggested =
            row.p_value >= 0.8 ? 'easy' :
            row.p_value >= 0.6 ? 'medium' :
            row.p_value >= 0.4 ? 'hard' : 'expert';
          return h('tr', {},
            h('td.wrap', {}, truncate(row.passage, 90)),
            h('td', {}, h('span.badge', { dataset: { difficulty: row.difficulty } }, row.difficulty)),
            h('td.num', {}, num(row.times_served)),
            h('td.num', {}, pct(row.p_value)),
            h('td', {}, h('span.badge', { dataset: { difficulty: suggested } }, suggested)));
        })
      : h('tr', {}, h('td', { colspan: '5', class: 'muted' },
          'Every published question is behaving the way its label predicts.')));
}

async function loadUsers() {
  const rows = await admin.listUsers({ search: $('#user-search').value.trim() });
  render($('#users-table'), rows.map((user) =>
    h('tr', {},
      h('th', { scope: 'row' },
        h('div', {}, `@${user.username}`),
        // Email comes from auth.users via an admin-only RPC. It is the same
        // address the premium request queue shows, so the two panels can be
        // cross-referenced.
        h('div.text-xs.muted', {}, user.email || 'no email on file')),

      h('td', {},
        h('div', {}, user.display_name || '—'),
        user.pending_requests
          ? h('span.badge.badge-warning', {},
              `${user.pending_requests} pending`)
          : null),

      h('td', {}, h('span.badge', {
        class: user.role === 'admin' ? 'badge-brand' : ''
      }, titleCase(user.role))),

      h('td', {},
        // is_premium can be true while premium_until has passed. Showing a
        // plain green badge there would be a lie.
        user.premium_active
          ? h('span.badge.badge-success', {
              title: user.premium_until ? new Date(user.premium_until).toString() : ''
            }, user.premium_until
              ? `Premium to ${dateTimeShort(user.premium_until)}` : 'Premium')
          : user.is_premium
            ? h('span.badge.badge-danger', {}, `Expired ${dateTimeShort(user.premium_until)}`)
            : h('span.muted.text-xs', {}, 'Free'),
        isAdmin()
          ? h('div.mt-2', {}, h('button.btn.btn-sm', {
              type: 'button',
              onclick: () => togglePremium(user)
            }, user.is_premium ? 'Revoke' : 'Grant'))
          : null),

      h('td', {}, dateShort(user.created_at)),

      h('td', {}, isAdmin()
        ? h('select.select.btn-sm', {
            'aria-label': `Role for ${user.username}`,
            value: user.role,
            async onchange(event) {
              try {
                await admin.setUserRole(user.id, event.target.value);
                toastSuccess(`@${user.username} is now ${event.target.value}.`);
              } catch (err) {
                toastError(err.message);
                event.target.value = user.role;
              }
            }
          }, ['student', 'author', 'moderator', 'admin'].map((role) =>
            h('option', { value: role, selected: role === user.role }, titleCase(role))))
        : h('span.subtle.text-xs', {}, 'Admin only')))));
}

/**
 * The direct grant, separate from the request queue.
 *
 * An admin needs this for the cases the queue cannot cover: comping an
 * account, fixing a mistaken rejection, or granting themselves premium —
 * which review_premium_request() deliberately refuses to do.
 */
async function togglePremium(user) {
  if (user.is_premium) {
    const ok = await confirmDialog({
      title: `Revoke premium for @${user.username}?`,
      message: 'They keep every free cheat sheet, all 151 questions, and all of their progress. Only the premium sheets lock again.',
      confirmLabel: 'Revoke',
      danger: true
    });
    if (!ok) return;
    try {
      await admin.setUserPremium(user.id, false, null);
      toastWarning(`Premium revoked for @${user.username}.`);
      await loadUsers();
    } catch (err) { toastError(err.message); }
    return;
  }

  const untilInput = h('input.input', {
    type: 'datetime-local', step: '60', id: 'grant-until'
  });

  openModal({
    title: `Grant premium to @${user.username}?`,
    body: h('div.stack', {},
      h('p.muted', {}, user.email || 'No email on file for this account.'),
      h('div.field', {},
        h('label.field__label', { for: 'grant-until' }, 'Premium ends'),
        untilInput,
        h('p.field__help', {}, 'Leave blank for no expiry. This bypasses the request queue — use it for comps and corrections.'))),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Grant', variant: 'btn-primary',
        onClick: () => ({ until: untilInput.value.trim() })
      }
    ],
    onClose: async (value) => {
      if (!value || typeof value !== 'object') return;
      // A datetime-local value is local wall time and `new Date()` parses
      // it as such, so this lands on the instant the admin meant.
      const until = value.until ? new Date(value.until).toISOString() : null;
      if (until && new Date(until) <= new Date()) {
        return toastError('That end date has already passed.');
      }
      try {
        await admin.setUserPremium(user.id, true, until);
        toastSuccess(until
          ? `@${user.username} has premium until ${dateTimeShort(until)}.`
          : `@${user.username} has premium with no expiry.`);
        await loadUsers();
      } catch (err) { toastError(err.message); }
    }
  });
}


let userSearchTimer;
$('#user-search').addEventListener('input', () => {
  clearTimeout(userSearchTimer);
  userSearchTimer = setTimeout(loadUsers, 300);
});

/* ---- bulk import ---------------------------------------------------------- */
function parseImport() {
  try {
    const parsed = JSON.parse($('#import-json').value);
    if (!Array.isArray(parsed)) throw new Error('The top level must be an array.');
    return parsed;
  } catch (err) {
    toastError(`Could not parse the JSON: ${err.message}`);
    return null;
  }
}

$('#validate-import').addEventListener('click', () => {
  const rows = parseImport();
  if (!rows) return;

  const problems = rows
    .map((row, index) => ({ index, problems: admin.validateDraft(row) }))
    .filter((entry) => entry.problems.length);

  render($('#import-report'),
    problems.length
      ? h('div.alert.alert-error', {}, h('div', {},
          h('strong', {}, `${problems.length} of ${rows.length} rows have problems:`),
          h('ul.mt-2', {}, problems.slice(0, 20).map((entry) =>
            h('li', {}, `Row ${entry.index}: ${entry.problems.join(' ')}`)))))
      : h('div.alert.alert-success', {},
          h('div', {}, `All ${rows.length} rows look valid. Duplicate passages will still be `
            + 'rejected by the database when you import.')));
});

$('#run-import').addEventListener('click', async (event) => {
  const rows = parseImport();
  if (!rows) return;

  const confirmed = await confirmDialog({
    title: `Import ${rows.length} questions?`,
    message: 'They will be created as drafts. Duplicate passages are rejected automatically.',
    confirmLabel: 'Import'
  });
  if (!confirmed) return;

  event.currentTarget.dataset.loading = 'true';
  const progress = h('div.progress', {}, h('div.progress__fill', { style: { width: '0%' } }));
  const status = h('p.text-sm.muted.mt-2', {}, 'Starting…');
  render($('#import-report'), progress, status);

  try {
    const report = await admin.importQuestions(rows, {
      onProgress({ done, total, created, duplicates }) {
        progress.firstChild.style.width = `${(done / total) * 100}%`;
        status.textContent = `${done} of ${total} · ${created} created · ${duplicates} duplicates skipped`;
      }
    });

    await admin.refreshRuleCounts();

    render($('#import-report'),
      h('div.alert.alert-success', {}, h('div', {},
        h('strong', {}, `Imported ${report.created} questions.`),
        report.duplicates ? h('p', {}, `${report.duplicates} were duplicates and were skipped.`) : null,
        report.failed.length
          ? h('details.mt-2', {},
              h('summary', {}, `${report.failed.length} failed`),
              h('ul.mt-2', {}, report.failed.slice(0, 30).map((failure) =>
                h('li', {}, `Row ${failure.index}: ${failure.reason}`))))
          : null)));
    await loadQuestions();
  } catch (err) {
    toastError(err.message);
  } finally {
    delete event.currentTarget.dataset.loading;
  }
});

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

/* ================================================================== */
/* Tags                                                               */
/* ================================================================== */

async function loadQuestionTags(questionId) {
  try {
    const tags = await admin.getQuestionTags(questionId);
    $('#e-tags').value = tags.map((tag) => tag.name).join(', ');
  } catch {
    $('#e-tags').value = '';
  }
}

/* ================================================================== */
/* Editorial quality                                                  */
/* ================================================================== */

let pendingRating = null;

function drawQualityStars(current) {
  pendingRating = current ? Math.round(current) : null;

  render($('#quality-stars'), [1, 2, 3, 4, 5].map((value) =>
    h('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(pendingRating === value),
      'aria-label': `${value} out of 5`,
      style: {
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 'var(--text-xl)', padding: '0 2px', lineHeight: '1',
        color: pendingRating && value <= pendingRating ? 'var(--warning)' : 'var(--border-strong)'
      },
      onclick() {
        pendingRating = value;
        drawQualityStars(value);
      }
    }, '\u2605')));
}

$('#save-rating').addEventListener('click', async () => {
  if (!editing?.id) return;
  if (!pendingRating) return toastError('Pick a rating from 1 to 5 first.');

  try {
    const result = await admin.rateQuestion(
      editing.id, pendingRating, $('#e-quality-notes').value || null);
    $('#quality-summary').textContent =
      `Mean ${result.quality_rating} from ${result.quality_votes} review(s).`;
    toastSuccess('Rating saved.');
    await loadQuestions();
  } catch (err) {
    toastError(err.message);
  }
});

$('#delete-question-btn').addEventListener('click', () => {
  if (editing?.id) confirmDelete([editing.id], editing.passage);
});

async function loadQualityQueue() {
  const rows = await admin.getUnratedQuestions(50);

  if (!rows.length) {
    render($('#quality-queue'), h('div.empty', {},
      h('p.empty__title', {}, 'Everything published has been reviewed'),
      h('p', {}, 'New questions appear here as soon as they go live.')));
    return;
  }

  render($('#quality-queue'), rows.map((row) =>
    h('article.card', {},
      h('div.row-wrap', {},
        h('span.badge', { dataset: { difficulty: row.difficulty } }, row.difficulty),
        h('span.text-sm.muted', {}, row.rule?.name || ''),
        h('div.spacer'),
        h('span.text-xs.subtle', {}, `Published ${relativeTime(row.created_at)}`)),
      h('p.mt-3', { style: { fontFamily: 'var(--font-serif)' } }, truncate(row.passage, 220)),
      h('div.row-wrap.mt-4', {},
        h('span.text-sm.muted', {}, 'Rate:'),
        [1, 2, 3, 4, 5].map((value) =>
          h('button.btn.btn-sm', {
            type: 'button',
            'aria-label': `Rate ${value} out of 5`,
            async onclick(event) {
              try {
                await admin.rateQuestion(row.id, value);
                event.currentTarget.closest('article').remove();
                toastSuccess(`Rated ${value}/5.`);
              } catch (err) {
                toastError(err.message);
              }
            }
          }, String(value))),
        h('button.btn.btn-sm.btn-ghost', {
          type: 'button', onclick: () => editQuestion(row.id)
        }, 'Open in editor')))));
}

/* ================================================================== */
/* Rule administration                                                */
/* ================================================================== */

async function loadRulesPanel() {
  const catalog = await getRules({ force: true });

  render($('#rules-table'), catalog.map((rule) => {
    const completeness = rule.bank_completeness ?? 0;

    return h('tr', {},
      h('th', { scope: 'row' }, rule.name),
      h('td.muted', {}, rule.domain_name),
      h('td', {},
        h('select.select.btn-sm', {
          'aria-label': `Concept difficulty for ${rule.name}`,
          async onchange(event) {
            try {
              await admin.updateRule(rule.id, { typical_difficulty: event.target.value });
              toastSuccess(`${rule.name} updated.`);
            } catch (err) {
              toastError(err.message);
              event.target.value = rule.typical_difficulty;
            }
          }
        }, ['easy', 'medium', 'hard', 'expert'].map((level) =>
          h('option', { value: level, selected: level === rule.typical_difficulty },
            titleCase(level))))),
      h('td.num', {}, num(rule.question_count)),
      h('td.num', {},
        h('input.input', {
          type: 'number', min: '0', max: '5000', step: '10',
          value: String(rule.question_target ?? 0),
          'aria-label': `Question target for ${rule.name}`,
          style: { width: '92px', minHeight: '34px', padding: 'var(--space-1) var(--space-2)' },
          async onchange(event) {
            try {
              await admin.updateRule(rule.id, { question_target: Number(event.target.value) });
              await loadRulesPanel();
            } catch (err) {
              toastError(err.message);
            }
          }
        })),
      h('td', {},
        h('div.row', {},
          h('div.progress.progress--thin', { style: { width: '90px' } },
            h('div.progress__fill', {
              style: { width: `${Math.round(completeness * 100)}%` },
              dataset: { tone: completeness >= 1 ? 'success' : completeness >= 0.5 ? null : 'danger' }
            })),
          h('span.text-xs.tabular', {}, pct(completeness)))),
      h('td.num', {}, rule.avg_quality != null ? `${rule.avg_quality} \u2605` : '\u2014'));
  }));
}

const KIND_BADGE = {
  bug: 'badge-danger', content: 'badge-warning',
  feature: 'badge-brand', praise: 'badge-success', other: ''
};

async function loadFeedback() {
  const rows = await listFeedback($('#feedback-state').value || null);

  if (!rows.length) {
    render($('#feedback-list'), h('div.empty', {},
      h('p.empty__title', {}, 'Nothing here'),
      h('p', {}, 'Feedback filed from the site appears in this queue.')));
    return;
  }

  render($('#feedback-list'), rows.map((item) => {
    const note = h('input.input', {
      type: 'text', placeholder: 'Internal note (optional)',
      value: item.staff_note || ''
    });

    const move = async (state) => {
      try {
        await setFeedbackState(item.id, state, note.value || null);
        toastSuccess(`Marked ${state}.`);
        await loadFeedback();
      } catch (err) {
        toastError(err.message);
      }
    };

    return h('article.card', {},
      h('div.row-wrap', {},
        h('span.badge', { class: KIND_BADGE[item.kind] || '' }, titleCase(item.kind)),
        h('span.badge', {}, titleCase(item.state)),
        h('span.text-sm.muted', {},
          item.reporter?.username ? `@${item.reporter.username}` : 'anonymous'),
        h('div.spacer'),
        h('span.text-xs.subtle', {}, relativeTime(item.created_at))),

      h('h3.card__title.mt-3', {}, item.subject),
      h('p.text-sm.mt-2', { style: { whiteSpace: 'pre-wrap' } }, item.body),

      h('p.text-xs.subtle.mt-3', {},
        `On ${item.page || 'unknown page'} · ${item.viewport || '?'} · `,
        h('span', { title: item.user_agent || '' },
          (item.user_agent || '').slice(0, 60) + '…')),

      h('div.field.mt-4', {}, note),
      h('div.row-wrap.mt-3', {},
        h('button.btn.btn-sm', { type: 'button', onclick: () => move('triaged') }, 'Triage'),
        h('button.btn.btn-sm.btn-secondary', { type: 'button', onclick: () => move('planned') }, 'Planned'),
        h('button.btn.btn-sm.btn-success', { type: 'button', onclick: () => move('done') }, 'Done'),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => move('declined') }, 'Decline')));
  }));
}

$('#feedback-state').addEventListener('change', loadFeedback);

/* ================================================================== */
/* Premium access: codes and the approval queue                       */
/* ================================================================== */

let reqFilter = 'pending';

$$('[data-req-filter]').forEach((chip) => chip.addEventListener('click', () => {
  reqFilter = chip.dataset.reqFilter;
  $$('[data-req-filter]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
  loadRequests();
}));

async function loadPremium() {
  if (!isAdmin() || !$('#panel-premium')) return;
  await Promise.all([loadRequests(), loadCodes()]);
}

/**
 * An ISO instant → the local "YYYY-MM-DDTHH:MM" a datetime-local wants.
 *
 * toISOString() would be wrong here: it is UTC, so prefilling with it
 * shifts the displayed time by the reader's offset. Subtracting the offset
 * first makes the slice come out as local wall time.
 */
function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);
}

/* ---- requests ----------------------------------------------------- */
async function loadRequests() {
  const body = $('#requests-table');
  render(body, h('tr', {}, h('td', { colspan: '5' }, h('span.muted', {}, 'Loading…'))));

  let rows;
  try {
    rows = await admin.listPremiumRequests(reqFilter === 'all' ? null : reqFilter);
  } catch (err) {
    render(body, h('tr', {}, h('td', { colspan: '5' },
      h('span.text-error', {}, err.message))));
    return;
  }

  $('#req-count').textContent = rows.length
    ? `${rows.length} ${reqFilter === 'all' ? 'total' : reqFilter}`
    : '';

  if (!rows.length) {
    render(body, h('tr', {}, h('td', { colspan: '5' },
      h('span.muted', {}, reqFilter === 'pending'
        ? 'Nothing waiting for review.'
        : `No ${reqFilter} requests.`))));
    return;
  }

  render(body, rows.map(requestRow));
}

function requestRow(r) {
  const pending = r.status === 'pending';

  return h('tr', {},
    h('td', {},
      h('div', {}, r.email),
      h('div.text-xs.muted', {}, `@${r.username}`),
      r.user_is_premium ? h('span.badge.badge-success', {}, 'premium') : null),

    h('td', {}, h('code', {}, r.code_used)),

    h('td', {},
      h('div', {}, dateShort(r.created_at)),
      h('div.text-xs.muted', {}, relativeTime(r.created_at))),

    h('td', {},
      h(`span.badge.badge-${
        { pending: 'warning', approved: 'success', rejected: 'danger' }[r.status]
      }`, {}, titleCase(r.status)),
      r.reviewed_at
        ? h('div.text-xs.muted.mt-1', {},
            `by ${r.reviewer || 'unknown'} · ${relativeTime(r.reviewed_at)}`)
        : null,
      r.granted_until
        ? h('div.text-xs.muted', {}, `until ${dateTimeShort(r.granted_until)}`)
        : (r.status === 'approved' ? h('div.text-xs.muted', {}, 'no expiry') : null),
      r.review_note ? h('div.text-xs.muted.mt-1', {}, r.review_note) : null),

    h('td', {}, pending
      // An admin reviewing their own request is refused by the database.
      // Saying so here beats letting them click and read a stack trace.
      ? (r.is_self
          ? h('span.text-xs.muted', {}, 'Your own request — another admin must review it.')
          : h('div.row-wrap', {},
              h('button.btn.btn-sm.btn-primary', {
                type: 'button', onclick: () => approve(r)
              }, 'Approve'),
              h('button.btn.btn-sm.btn-danger', {
                type: 'button', onclick: () => reject(r)
              }, 'Reject')))
      : h('span.text-xs.muted', {}, '—')));
}

async function approve(r) {
  const choice = await askUntil(r);
  if (choice === null) return;                   // cancelled

  try {
    const out = await admin.reviewPremiumRequest(r.id, true,
      { until: choice.until, note: choice.note });
    toastSuccess(out.granted_until
      ? `${r.email} has premium until ${dateTimeShort(out.granted_until)}.`
      : `${r.email} has premium with no expiry.`);
    await loadPremium();
  } catch (err) {
    toastError(err.message);
  }
}

async function reject(r) {
  const ok = await confirmDialog({
    title: 'Reject this request?',
    message: `${r.email} stays on the free plan. The code is not consumed, so it can be used by someone else.`,
    confirmLabel: 'Reject',
    danger: true
  });
  if (!ok) return;

  try {
    await admin.reviewPremiumRequest(r.id, false);
    toastWarning(`Request from ${r.email} rejected.`);
    await loadPremium();
  } catch (err) {
    toastError(err.message);
  }
}

/**
 * Approval needs a duration. The code may carry a default; the admin can
 * override it here, which is the whole point of reviewing by hand.
 */
function askUntil(r) {
  return new Promise((resolve) => {
    const untilInput = h('input.input', {
      type: 'datetime-local', step: '60', id: 'approve-until',
      value: toLocalInput(r.code_grant_until)
    });
    const noteInput = h('input.input', {
      type: 'text', maxlength: '300', id: 'approve-note',
      placeholder: 'Optional note on the decision'
    });

    openModal({
      title: `Approve ${r.email}?`,
      body: h('div.stack', {},
        h('p.muted', {}, r.code_grant_until
          ? `The code ${r.code_used} ends premium on ${dateTimeShort(r.code_grant_until)}. Change it if you like.`
          : `The code ${r.code_used} sets no end date, so premium would not expire.`),
        h('div.field', {},
          h('label.field__label', { for: 'approve-until' }, 'Premium ends'),
          untilInput,
          h('p.field__help', {}, 'Clear the field to grant premium with no expiry date.')),
        h('div.field', {},
          h('label.field__label', { for: 'approve-note' }, 'Note (optional)'),
          noteInput)),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Approve',
          variant: 'btn-primary',
          // openModal closes for us and hands whatever this returns to
          // onClose, so the payload travels as the dialog's result.
          onClick: () => {
            const raw = untilInput.value.trim();
            return {
              until: raw === '' ? null : new Date(raw).toISOString(),
              note: noteInput.value.trim()
            };
          }
        }
      ],
      // Cancel resolves to `true`, the close button and Esc to `null`.
      // Only the Approve action produces an object.
      onClose: (value) => resolve(value && typeof value === 'object' ? value : null)
    });
  });
}

/* ---- codes -------------------------------------------------------- */
async function loadCodes() {
  const body = $('#codes-table');
  render(body, h('tr', {}, h('td', { colspan: '6' }, h('span.muted', {}, 'Loading…'))));

  let rows;
  try {
    rows = await admin.listPremiumCodes();
  } catch (err) {
    render(body, h('tr', {}, h('td', { colspan: '6' },
      h('span.text-error', {}, err.message))));
    return;
  }

  if (!rows.length) {
    render(body, h('tr', {}, h('td', { colspan: '6' },
      h('span.muted', {}, 'No codes yet. Create one above.'))));
    return;
  }

  render(body, rows.map(codeRow));
}

function codeRow(c) {
  // "Active" is the switch you control. Expired and exhausted are facts
  // about the code that no longer depend on the switch, so they are shown
  // separately rather than collapsed into one boolean.
  const dead = !c.active || c.expired || c.exhausted;

  return h('tr', { style: dead ? { opacity: '0.6' } : {} },
    h('td', {},
      h('code', { style: { fontSize: 'var(--text-md)' } }, c.code),
      c.note ? h('div.text-xs.muted', {}, c.note) : null,
      h('div.text-xs.muted', {}, `created ${dateShort(c.created_at)}`)),

    h('td', {},
      h('span', {}, `${c.current_uses} / ${c.max_uses}`),
      c.pending_count
        ? h('div.text-xs.muted', {}, `${c.pending_count} pending`)
        : null),

    h('td', {}, c.grant_until
      ? h('span', {
          // A grant date that has already passed would approve people into
          // an expired subscription, so flag it rather than showing a
          // neutral date.
          class: c.grant_lapsed ? 'text-error' : '',
          title: new Date(c.grant_until).toString()
        }, dateTimeShort(c.grant_until) + (c.grant_lapsed ? ' (passed)' : ''))
      : h('span.muted', {}, 'no expiry')),

    h('td', {}, c.expires_at
      ? h('span', { title: new Date(c.expires_at).toString() }, dateTimeShort(c.expires_at))
      : h('span.muted', {}, 'never')),

    h('td', {},
      c.exhausted ? h('span.badge.badge-danger', {}, 'Used up')
      : c.expired ? h('span.badge.badge-danger', {}, 'Expired')
      : c.active  ? h('span.badge.badge-success', {}, 'Active')
                  : h('span.badge', {}, 'Disabled')),

    h('td', {}, h('div.row-wrap', {},
      h('button.btn.btn-sm', {
        type: 'button',
        onclick: async () => {
          try {
            await admin.setCodeActive(c.id, !c.active);
            toastSuccess(`${c.code} ${c.active ? 'disabled' : 'enabled'}.`);
            await loadCodes();
          } catch (err) { toastError(err.message); }
        }
      }, c.active ? 'Disable' : 'Enable'),

      h('button.btn.btn-sm.btn-danger', {
        type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({
            title: `Delete ${c.code}?`,
            message: 'The code stops working immediately. Requests that used it keep their history.',
            confirmLabel: 'Delete',
            danger: true
          });
          if (!ok) return;
          try {
            await admin.deletePremiumCode(c.id);
            toastSuccess(`${c.code} deleted.`);
            await loadPremium();
          } catch (err) { toastError(err.message); }
        }
      }, 'Delete'))));
}

$('#code-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#create-code-btn');
  btn.disabled = true;

  try {
    const expires = $('#c-expires').value;
    const grantUntil = $('#c-grant-until').value;
    const created = await admin.createPremiumCode({
      code: $('#c-code').value.trim() || null,
      maxUses: $('#c-max-uses').value,
      // "YYYY-MM-DDTHH:MM" from a datetime-local input is local wall time,
      // and `new Date()` parses it as such, so this lands on the instant
      // the admin actually meant regardless of their timezone.
      expiresAt: expires ? new Date(expires).toISOString() : null,
      grantUntil: grantUntil ? new Date(grantUntil).toISOString() : null,
      note: $('#c-note').value.trim() || null
    });
    toastSuccess(`Code ${created.code} created.`);
    $('#code-form').reset();
    $('#c-max-uses').value = '1';
    await loadCodes();
  } catch (err) {
    toastError(err.message);
  } finally {
    btn.disabled = false;
  }
});


const LOADERS = {
  questions: loadQuestions,
  coverage: loadCoverage,
  reports: loadReports,
  calibration: loadCalibration,
  feedback: loadFeedback,
  quality: loadQualityQueue,
  rules: loadRulesPanel,
  users: loadUsers,
  premium: loadPremium
};

await loadQuestions();
