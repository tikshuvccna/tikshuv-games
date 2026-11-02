/** Tiny hash router + screen manager. Screens are factories returning a root element and an optional destroy. */
import { prefersReducedMotion } from '@tikshuv/ui';

export interface Screen {
  el: HTMLElement;
  /** HUD title; falls back to the route's title. */
  title?: string;
  /** Called after the leave transition, before the element is removed. */
  destroy?: () => void;
}
export interface RouteMeta {
  /** Show the HUD (menu, title, timer). Default true. */
  chrome?: boolean;
  /** Document title key (already translated by the factory through `Screen.el` aria-label is not used). */
  title?: string;
}
export type ScreenFactory<C> = (ctx: C, args: string[]) => Screen | Promise<Screen>;
interface Route<C> {
  make: ScreenFactory<C>;
  meta: RouteMeta;
}

export interface RouteChange {
  name: string;
  args: string[];
  meta: RouteMeta;
  title?: string | undefined;
}

const LEAVE_MS = 160;

export class Router<C> {
  private routes = new Map<string, Route<C>>();
  private current: { screen: Screen; name: string } | null = null;
  private token = 0;
  private listeners = new Set<(c: RouteChange) => void>();
  private fallback = '';

  constructor(
    private readonly ctx: C,
    private readonly stage: HTMLElement,
  ) {}

  add(name: string, make: ScreenFactory<C>, meta: RouteMeta = {}): this {
    this.routes.set(name, { make, meta });
    return this;
  }
  setFallback(name: string): this {
    this.fallback = name;
    return this;
  }
  onChange(fn: (c: RouteChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get name(): string | null {
    return this.current?.name ?? null;
  }

  /** Navigate: `go('scene/p00_demo')` sets the hash; the hashchange listener mounts the screen. */
  go(path: string): void {
    const next = `#/${path.replace(/^#?\/?/, '')}`;
    if (location.hash === next) void this.render();
    else location.hash = next;
  }

  start(): void {
    window.addEventListener('hashchange', () => void this.render());
    void this.render();
  }

  private parse(): { name: string; args: string[] } {
    const raw = location.hash.replace(/^#\/?/, '');
    const [name = '', ...args] = raw.split('/').map((s) => decodeURIComponent(s));
    return { name: name || this.fallback, args };
  }

  async render(): Promise<void> {
    const mine = ++this.token;
    let { name, args } = this.parse();
    let route = this.routes.get(name);
    if (!route) {
      name = this.fallback;
      args = [];
      route = this.routes.get(name);
    }
    if (!route) return;

    const prev = this.current;
    if (prev) {
      prev.screen.el.classList.add('is-leaving');
      const wait = prefersReducedMotion() ? 0 : LEAVE_MS;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (mine !== this.token) return; // a newer navigation took over while we faded out
      prev.screen.destroy?.();
      prev.screen.el.remove();
      this.current = null;
    }
    let screen: Screen;
    try {
      screen = await route.make(this.ctx, args);
    } catch (e) {
      console.error('screen failed', name, e);
      return;
    }
    if (mine !== this.token) {
      screen.destroy?.();
      return;
    }
    screen.el.classList.add('cf-screen');
    screen.el.setAttribute('tabindex', '-1');
    this.stage.appendChild(screen.el);
    this.current = { screen, name };
    window.scrollTo(0, 0);
    screen.el.focus({ preventScroll: true });
    const change: RouteChange = { name, args, meta: route.meta, title: screen.title };
    for (const l of this.listeners) l(change);
  }
}
