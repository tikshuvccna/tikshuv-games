import { cx, h, renderRich, uiText } from './dom';
import { tkIcon, type IconName } from './icons';

export type ToastTone = 'info' | 'success' | 'warn' | 'error' | 'reward';

export interface ToastOptions {
  /** Rich text: <ltr>...</ltr> islands allowed (numbers with signs, IPs, terms). */
  message: string;
  title?: string;
  tone?: ToastTone;
  icon?: IconName;
  /** ms on screen; 0 = sticky until dismissed. Default --tk-dur-toast (4500). Errors default to sticky. */
  timeout?: number;
  /** Render into this element instead of the shared region (used by the story page). */
  host?: HTMLElement;
}

const TONE_ICON: Record<ToastTone, IconName> = {
  info: 'info',
  success: 'check',
  warn: 'warning',
  error: 'warning',
  reward: 'coin',
};

let region: HTMLElement | null = null;

function sharedRegion(): HTMLElement {
  if (region?.isConnected) return region;
  // The live region exists before any toast is inserted, so screen readers reliably announce additions.
  region = h('section', { class: 'tk-toast-region', 'aria-label': uiText('tk.notifications'), 'aria-live': 'polite', 'aria-relevant': 'additions' });
  document.body.appendChild(region);
  return region;
}

/** Builds a toast element without mounting it (static docs, custom hosts). */
export function tkToastEl(o: ToastOptions, onDismiss?: () => void): HTMLElement {
  const tone = o.tone ?? 'info';
  const el = h(
    'div',
    { class: cx('tk-toast', `tk-toast--${tone}`), role: tone === 'error' ? 'alert' : undefined },
    h('span', { class: 'tk-toast__icon' }, tkIcon(o.icon ?? TONE_ICON[tone])),
    h(
      'div',
      { class: 'tk-toast__text' },
      o.title ? h('strong', { class: 'tk-toast__title' }, o.title) : null,
      h('span', { class: 'tk-toast__msg' }, renderRich(o.message)),
    ),
  );
  const close = h('button', { type: 'button', class: 'tk-toast__close', 'aria-label': uiText('tk.dismiss') }, tkIcon('close', { size: 18 }));
  close.addEventListener('click', () => onDismiss?.());
  el.appendChild(close);
  return el;
}

/** Shows a toast in the shared live region. Returns a dismiss function. */
export function tkToast(o: ToastOptions): () => void {
  const host = o.host ?? sharedRegion();
  let timer = 0;
  const dismiss = () => {
    window.clearTimeout(timer);
    el.classList.add('tk-toast--leaving');
    const done = () => el.remove();
    el.addEventListener('animationend', done, { once: true });
    window.setTimeout(done, 400); // fallback when animations are disabled
  };
  const el = tkToastEl(o, dismiss);
  host.appendChild(el);
  const timeout = o.timeout ?? (o.tone === 'error' ? 0 : 4500);
  if (timeout > 0) {
    timer = window.setTimeout(dismiss, timeout);
    // Pause while hovered or focused (WCAG 2.2.1 timing adjustable).
    const pause = () => window.clearTimeout(timer);
    const resume = () => {
      timer = window.setTimeout(dismiss, 2000);
    };
    el.addEventListener('pointerenter', pause);
    el.addEventListener('pointerleave', resume);
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', resume);
  }
  return dismiss;
}
