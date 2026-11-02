import { h, nextId, type Child } from './dom';

export interface TabDef {
  id: string;
  label: string;
  panel: Child | Child[];
}

export interface TabsOptions {
  /** Accessible name of the tab list. */
  label: string;
  tabs: TabDef[];
  selected?: string;
  onChange?: (id: string) => void;
}

/**
 * Folder tabs (WAI-ARIA tabs pattern, automatic activation, roving tabindex).
 * Arrow keys follow the visual direction, so in RTL ArrowLeft moves to the next tab.
 */
export function tkTabs(o: TabsOptions): HTMLElement {
  const base = nextId('tk-tabs');
  const list = h('div', { class: 'tk-tabs__list', role: 'tablist', 'aria-label': o.label });
  const root = h('div', { class: 'tk-tabs' }, list);
  const buttons: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];

  o.tabs.forEach((t) => {
    const tabId = `${base}-tab-${t.id}`;
    const panelId = `${base}-panel-${t.id}`;
    const btn = h('button', { type: 'button', role: 'tab', id: tabId, class: 'tk-tabs__tab', 'aria-controls': panelId }, t.label);
    const content = Array.isArray(t.panel) ? t.panel : [t.panel];
    const panel = h('div', { role: 'tabpanel', id: panelId, class: 'tk-tabs__panel', 'aria-labelledby': tabId, tabindex: 0 }, ...content);
    btn.addEventListener('click', () => select(t.id, false));
    buttons.push(btn);
    panels.push(panel);
    list.appendChild(btn);
    root.appendChild(panel);
  });

  function select(id: string, focus: boolean) {
    o.tabs.forEach((t, i) => {
      const on = t.id === id;
      const b = buttons[i]!;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      panels[i]!.hidden = !on;
      if (on && focus) b.focus();
    });
    o.onChange?.(id);
  }

  list.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const rtl = getComputedStyle(root).direction === 'rtl';
    const n = buttons.length;
    let j: number;
    if (e.key === 'ArrowRight') j = rtl ? i - 1 : i + 1;
    else if (e.key === 'ArrowLeft') j = rtl ? i + 1 : i - 1;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    else return;
    e.preventDefault();
    j = (j + n) % n;
    select(o.tabs[j]!.id, true);
  });

  const first = o.tabs[0];
  if (first) {
    // Initial state without firing onChange.
    const initial = o.selected ?? first.id;
    o.tabs.forEach((t, i) => {
      const on = t.id === initial;
      buttons[i]!.setAttribute('aria-selected', String(on));
      buttons[i]!.tabIndex = on ? 0 : -1;
      panels[i]!.hidden = !on;
    });
  }
  return root;
}
