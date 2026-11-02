/** App context shared by all screens: save, audio, session timer, router, grade and small helpers. */
import { SessionTimer, sessionPreset, sessionResume, type SceneMoodId, type SessionPreset } from '@tikshuv/core';
import { AudioBus } from '@tikshuv/audio';
import { cabinetSlots, createDefaultSave, isCaseUnlocked, isUnitComplete, type SaveStore, type SaveV1 } from '@tikshuv/save';
import { tkToast } from '@tikshuv/ui';
import { CASES, CASE_UNITS, THOUGHTS, UNITS, gradeFor, type CaseDef } from './catalog';
import { t } from './i18n';
import type { Router } from './router';

const MIN = 60_000;
const BLACKOUT_DEFER_MAX_MS = 3 * MIN;

export type CaseStatus = 'locked' | 'open' | 'solved';

export interface NextStep {
  caseDef: CaseDef;
  /** Next unfinished unit (lesson) of the case, if the case has units. */
  unitId?: string;
}

export class App {
  readonly audio: AudioBus;
  readonly timer: SessionTimer;
  router!: Router<App>;
  /** The most recent blackout sent the player back to the hub; the hub shows the mentor's note once. */
  afterBlackout = false;
  private holds = 0;
  private blackoutPending = false;
  private deferTimer = 0;
  private cookAcc = 0;
  private timers: number[] = [];

  constructor(readonly store: SaveStore) {
    const s = store.getState();
    this.audio = new AudioBus({
      settings: s.settings.audio,
      onSettingsChange: (a) => store.update((d) => void (d.settings.audio = a)),
    });
    this.audio.unlockOnFirstGesture(window);
    this.audio.bindVisibility(document);

    const dev = new URLSearchParams(location.search).get('cap');
    const cap = dev ? Number.parseFloat(dev) : Number.NaN;
    const cfg =
      Number.isFinite(cap) && cap > 0
        ? { capMs: cap * 1000, warnAtMs: cap * 600 }
        : sessionPreset((s.settings.sessionCapMinutes ?? 'off') as SessionPreset);
    const resume = sessionResume(s.session, Date.now());
    this.timer = new SessionTimer({
      ...cfg,
      // an ended session is a finished day: a reload starts a fresh one
      ...(resume.ended ? {} : resume),
    });
    this.timer.on('warning', () => this.onWarning());
    this.timer.on('blackout', () => this.onBlackout());

    this.timers.push(window.setInterval(() => this.persistSession(), 15_000));
    this.timers.push(window.setInterval(() => this.tickCabinet(), 1000));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.persistSession();
    });
  }

  get save(): Readonly<SaveV1> {
    return this.store.getState();
  }
  update(fn: (d: SaveV1) => void): void {
    this.store.update(fn);
  }
  get name(): string {
    return this.save.profile.displayName.trim() || t('name.default');
  }

  /* ---------------------------------------------------------- mood and grade */

  /** Sets the audio mood and the page colour grade together (one id drives both, style bible 4). */
  setMood(id: SceneMoodId): void {
    this.audio.setMood(id);
    this.setGrade(gradeFor(id));
  }
  setGrade(grade: string): void {
    document.body.dataset['mood'] = grade;
  }

  /* ---------------------------------------------------------- progress derivations */

  caseStatus(c: CaseDef): CaseStatus {
    const s = this.save;
    if (s.cases[c.id]?.solved) return 'solved';
    return isCaseUnlocked(c.id, s.units, CASE_UNITS, s.cases) ? 'open' : 'locked';
  }

  /** First case that is open and not solved, and inside it the first unfinished unit. */
  nextStep(): NextStep | null {
    for (const c of CASES) {
      if (this.caseStatus(c) !== 'open') continue;
      const unitId = c.units.find((u) => {
        const p = this.save.units[u];
        return !(p && isUnitComplete(p));
      });
      return unitId ? { caseDef: c, unitId } : { caseDef: c };
    }
    return null;
  }

  unitTitle(id: string): string {
    return UNITS[id]?.title ?? id;
  }
  slots(): number {
    return cabinetSlots(this.save);
  }

  /* ---------------------------------------------------------- session */

  startSession(): void {
    this.timer.start();
  }

  persistSession(): void {
    const snap = this.timer.snapshot();
    this.store.update((d) => {
      d.session.elapsedMs = Math.round(snap.elapsedMs);
      d.session.warned = snap.warned;
      d.session.ended = snap.ended;
      d.session.lastActiveAt = new Date().toISOString();
      d.session.startedAt ??= d.session.lastActiveAt;
    });
  }

  /** A red check or a mini-game run must not be cut mid-attempt (spec 02 8.2). Returns the release function. */
  hold(): () => void {
    this.holds += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds = Math.max(0, this.holds - 1);
      if (this.holds === 0 && this.blackoutPending) this.fireBlackout();
    };
  }

  private onWarning(): void {
    this.persistSession();
    this.audio.play('notification');
    tkToast({ title: t('session.warn.title'), message: t('session.warn'), tone: 'warn', icon: 'watch', timeout: 9000 });
    document.body.classList.add('is-warned');
  }

  private onBlackout(): void {
    if (this.holds > 0) {
      this.blackoutPending = true;
      window.clearTimeout(this.deferTimer);
      this.deferTimer = window.setTimeout(() => this.fireBlackout(), BLACKOUT_DEFER_MAX_MS);
      return;
    }
    this.fireBlackout();
  }

  private fireBlackout(): void {
    window.clearTimeout(this.deferTimer);
    this.blackoutPending = false;
    this.persistSession();
    this.router.go('blackout');
  }

  /** The blackout screen is over: a fresh session starts in the hub (soft cooldown 0, spec 02 8.2). */
  beginNewSession(): void {
    this.timer.reset();
    document.body.classList.remove('is-warned');
    this.afterBlackout = true;
    this.update((d) => {
      d.session = { elapsedMs: 0, warned: false, ended: false };
    });
    this.timer.start();
  }

  /* ---------------------------------------------------------- Thought Cabinet clock */

  /** Thoughts cook on active play time only: the session timer must be counting. */
  private tickCabinet(): void {
    const ph = this.timer.phase;
    if (ph !== 'running' && ph !== 'warned') return;
    this.cookAcc += 1000;
    if (this.cookAcc < 5000) return;
    const add = this.cookAcc;
    this.cookAcc = 0;
    const done: string[] = [];
    const cooking = Object.values(this.save.thoughts).some((th) => th.state === 'internalising');
    if (!cooking) return;
    this.update((d) => {
      for (const [id, th] of Object.entries(d.thoughts)) {
        if (th.state !== 'internalising') continue;
        th.progressMs += add;
        const need = (THOUGHTS[id]?.minutes ?? 3) * MIN;
        if (th.progressMs >= need) {
          th.state = 'internalised';
          th.progressMs = need;
          done.push(id);
        }
      }
    });
    for (const id of done) {
      this.audio.play('sparkle');
      tkToast({ title: t('cabinet.done'), message: THOUGHTS[id]?.title ?? id, tone: 'success' });
    }
  }

  /* ---------------------------------------------------------- reset */

  resetProgress(): void {
    this.update((d) => {
      const fresh = createDefaultSave();
      fresh.settings = d.settings;
      fresh.profile = { ...fresh.profile, displayName: d.profile.displayName };
      fresh.createdAt = d.createdAt;
      Object.assign(d, fresh);
    });
    void this.store.flush();
  }

  dispose(): void {
    this.timers.forEach((id) => window.clearInterval(id));
    this.timer.dispose();
    this.audio.dispose();
  }
}
