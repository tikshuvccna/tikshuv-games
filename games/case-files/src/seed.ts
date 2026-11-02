/** Dev helper: fills the save with a believable mid-game state (used by #/dev and ?seed=demo for screenshots). */
import type { App } from './app';
import { EVIDENCE } from './catalog';
import { t } from './i18n';

export function seedDemo(app: App): void {
  app.update((d) => {
    d.profile.displayName ||= t('lab.seed.name');
    d.voices = {
      logic: { level: 3, pips: 1 },
      packet_sense: { level: 2, pips: 0 },
      patience: { level: 1, pips: 2 },
      suspicion: { level: 2, pips: 1 },
      recall: { level: 1, pips: 0 },
      command_line: { level: 0, pips: 0 },
    };
    d.evidence = Object.keys(EVIDENCE);
    d.thoughts = {
      th_who_sends: { state: 'internalised', progressMs: 3 * 60_000, slot: 0 },
      th_mac_vs_ip: { state: 'internalising', progressMs: 130_000, slot: 1 },
      th_one_label: { state: 'known', progressMs: 0 },
    };
    d.cases['prologue'] = { solved: true };
    d.units['u01_frame_mac'] = { lessonViewed: true, checks: 3, quizScore: 7 };
    d.units['u02_switch_table'] = { lessonViewed: true, checks: 1, quizScore: 0 };
    d.coins = 120;
    d.lastPlayedAt ??= new Date().toISOString();
  });
}

export function completeUnits(app: App, ids: string[]): void {
  app.update((d) => {
    for (const id of ids) d.units[id] = { lessonViewed: true, checks: 3, quizScore: 8 };
  });
}
