/**
 * PracticeRunner — owns the state machine for one practice session.
 *
 * States per question:  unanswered → answered (graded) → next
 * The runner never knows the correct answer until the server grades the
 * attempt, so there is nothing in memory for a student to inspect.
 */
import { Stopwatch } from './engine-timer.js';
import { submitAnswer, finishSession, getSessionQuestions } from './svc-practice.js';
import { toggleBookmark } from './svc-questions.js';
import { toggleFlag, getSessionFlags } from './svc-practice.js';
import { emit } from './core-events.js';

export class PracticeRunner {
  constructor({ session, mode, instantFeedback = true }) {
    this.session = session;
    this.mode = mode;
    this.instantFeedback = instantFeedback;

    this.questions = [];
    this.index = 0;
    this.results = new Map();     // questionId → grade payload
    this.selected = null;         // choiceId currently highlighted
    this.stopwatch = new Stopwatch();
    this.finished = false;
    this.flags = new Set();          // question ids marked for a second look
    this.reviewing = false;          // showing the pre-submit review screen

    this._handlers = { change: new Set(), graded: new Set(), done: new Set() };
  }

  /* ---- lifecycle ---------------------------------------------------- */

  async load() {
    const [questions, flags] = await Promise.all([
      getSessionQuestions(this.session.id),
      getSessionFlags(this.session.id).catch(() => new Set())
    ]);
    this.questions = questions;
    this.flags = flags;
    this.index = Math.min(this.session.cursor || 0, this.questions.length - 1);
    this._emitChange();
    this.stopwatch.start();
    return this.questions;
  }

  get current()   { return this.questions[this.index] || null; }
  get total()     { return this.questions.length; }
  get answered()  { return this.results.size; }
  get correct()   { return [...this.results.values()].filter((r) => r.is_correct).length; }
  get accuracy()  { return this.answered ? this.correct / this.answered : 0; }
  get isLast()    { return this.index >= this.questions.length - 1; }
  get isGraded()  { return this.results.has(this.current?.id); }
  get grade()     { return this.results.get(this.current?.id) || null; }

  /* ---- answering ----------------------------------------------------- */

  select(choiceId) {
    if (this.isGraded) return;
    this.selected = choiceId;
    this._emitChange();
  }

  async submit({ skipped = false, usedHint = false } = {}) {
    const question = this.current;
    if (!question || this.isGraded) return null;
    if (!skipped && !this.selected) return null;

    this.stopwatch.pause();
    const timeMs = this.stopwatch.read();

    const grade = await submitAnswer({
      questionId: question.id,
      choiceId: skipped ? null : this.selected,
      timeMs,
      sessionId: this.session.id,
      mode: this.mode,
      skipped,
      usedHint
    });

    const record = { ...grade, selected_choice_id: this.selected, time_ms: timeMs, skipped };
    this.results.set(question.id, record);
    this._handlers.graded.forEach((fn) => fn(record, question));
    this._emitChange();

    // Without instant feedback the runner advances immediately, exam-style.
    if (!this.instantFeedback) await this.next();
    return record;
  }

  skip() { return this.submit({ skipped: true }); }

  /* ---- navigation ----------------------------------------------------- */

  async next() {
    if (this.isLast) return this.finish();
    this.index++;
    this._resetForQuestion();
    return null;
  }

  previous() {
    if (this.index === 0) return;
    this.index--;
    this._resetForQuestion();
  }

  goTo(index) {
    if (index < 0 || index >= this.questions.length) return;
    this.reviewing = false;
    this.index = index;
    this._resetForQuestion();
  }

  /** Jump to the next question that has not been answered yet. */
  goToNextUnanswered() {
    const next = this.questions.findIndex(
      (q, i) => i > this.index && !this.results.has(q.id));
    const wrapped = next >= 0
      ? next
      : this.questions.findIndex((q) => !this.results.has(q.id));
    if (wrapped >= 0) this.goTo(wrapped);
    return wrapped;
  }

  goToNextFlagged() {
    const next = this.questions.findIndex(
      (q, i) => i > this.index && this.flags.has(q.id));
    const wrapped = next >= 0
      ? next
      : this.questions.findIndex((q) => this.flags.has(q.id));
    if (wrapped >= 0) this.goTo(wrapped);
    return wrapped;
  }

  _resetForQuestion() {
    this.selected = null;
    this.stopwatch.reset();
    if (!this.isGraded) this.stopwatch.start();
    this._emitChange();
  }

  /* ---- bookmarks ------------------------------------------------------ */

  /* ---- flagging ------------------------------------------------------ */

  get isFlagged() {
    return this.flags.has(this.current?.id);
  }

  async toggleFlag() {
    const question = this.current;
    if (!question) return null;

    // Update locally first so the button responds instantly; the server
    // call is idempotent, so a failure just leaves the two out of sync
    // until the next load rather than corrupting anything.
    const on = !this.flags.has(question.id);
    on ? this.flags.add(question.id) : this.flags.delete(question.id);
    this._emitChange();

    try {
      await toggleFlag(this.session.id, question.id);
    } catch {
      on ? this.flags.delete(question.id) : this.flags.add(question.id);
      this._emitChange();
    }
    return on;
  }

  /* ---- review before submitting --------------------------------------- */

  get unanswered() {
    return this.questions.filter((q) => !this.results.has(q.id));
  }

  get flagged() {
    return this.questions.filter((q) => this.flags.has(q.id));
  }

  /**
   * A student should not be able to submit without seeing what they are
   * about to submit. This produces the summary the review screen renders.
   */
  reviewSummary() {
    return {
      total: this.total,
      answered: this.answered,
      unanswered: this.unanswered.length,
      flagged: this.flagged.length,
      rows: this.questions.map((question, i) => ({
        index: i,
        question,
        answered: this.results.has(question.id),
        flagged: this.flags.has(question.id),
        skipped: this.results.get(question.id)?.skipped === true
      }))
    };
  }

  openReview() { this.reviewing = true; this.stopwatch.pause(); this._emitChange(); }

  closeReview() {
    this.reviewing = false;
    if (!this.isGraded) this.stopwatch.start();
    this._emitChange();
  }

  async toggleBookmark() {
    const question = this.current;
    if (!question) return null;
    const bookmarked = await toggleBookmark(question.id);
    question.bookmarked = bookmarked;
    this._emitChange();
    return bookmarked;
  }

  /* ---- completion ------------------------------------------------------ */

  async finish() {
    if (this.finished) return null;
    this.finished = true;
    this.stopwatch.pause();

    const closed = await finishSession(this.session.id);
    const summary = {
      session: closed,
      total: this.total,
      answered: this.answered,
      correct: this.correct,
      accuracy: this.accuracy,
      durationMs: closed.duration_ms,
      byRule: this._breakdownByRule(),
      byDifficulty: this._breakdownByDifficulty(),
      missed: this.questions.filter((q) => this.results.get(q.id)?.is_correct === false)
    };

    this._handlers.done.forEach((fn) => fn(summary));
    this.stopwatch.destroy();
    return summary;
  }

  _breakdownByRule() {
    const map = new Map();
    for (const question of this.questions) {
      const result = this.results.get(question.id);
      if (!result) continue;
      const key = question.rule.slug;
      const row = map.get(key) || { name: question.rule.name, slug: key, total: 0, correct: 0 };
      row.total++;
      if (result.is_correct) row.correct++;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.correct / a.total - b.correct / b.total);
  }

  _breakdownByDifficulty() {
    const map = {};
    for (const question of this.questions) {
      const result = this.results.get(question.id);
      if (!result) continue;
      map[question.difficulty] ||= { total: 0, correct: 0 };
      map[question.difficulty].total++;
      if (result.is_correct) map[question.difficulty].correct++;
    }
    return map;
  }

  /* ---- observation ------------------------------------------------------ */

  onChange(fn) { this._handlers.change.add(fn); return () => this._handlers.change.delete(fn); }
  onGraded(fn) { this._handlers.graded.add(fn); return () => this._handlers.graded.delete(fn); }
  onDone(fn)   { this._handlers.done.add(fn);   return () => this._handlers.done.delete(fn); }

  _emitChange() { this._handlers.change.forEach((fn) => fn(this)); }

  /** Dot states for the session progress rail. */
  dotStates() {
    return this.questions.map((question, i) => {
      const result = this.results.get(question.id);
      const flagged = this.flags.has(question.id);
      if (i === this.index && !result) return flagged ? 'current-flagged' : 'current';
      if (!result) return flagged ? 'flagged' : 'pending';
      if (result.skipped) return 'skipped';
      return result.is_correct ? 'correct' : 'incorrect';
    });
  }
}
