import { cx, h } from './dom';
import { tkIcon, type IconName } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'choice';

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  icon?: IconName;
  /** Put the icon at inline-end (e.g. a "next" chevron). Default: start. */
  iconEnd?: boolean;
  /** Icon-only button: label becomes the aria-label and a tooltip. */
  iconOnly?: boolean;
  /** Small leading key hint for numbered choices ("1", "2"...), shown as an LTR badge. */
  keyHint?: string;
  disabled?: boolean;
  block?: boolean;
  type?: 'button' | 'submit';
  onClick?: (e: MouseEvent) => void;
}

export function tkButton(o: ButtonOptions): HTMLButtonElement {
  const variant = o.variant ?? 'secondary';
  const btn = h('button', {
    type: o.type ?? 'button',
    class: cx(
      'tk-btn',
      `tk-btn--${variant}`,
      o.size === 'lg' && 'tk-btn--lg',
      o.iconOnly && 'tk-btn--icon',
      o.block && 'tk-btn--block',
    ),
    disabled: o.disabled,
    'aria-label': o.iconOnly ? o.label : undefined,
    title: o.iconOnly ? o.label : undefined,
  });
  const icon = o.icon ? tkIcon(o.icon, { size: o.size === 'lg' ? 22 : 20 }) : null;
  if (o.keyHint) btn.appendChild(h('span', { class: 'tk-btn__key', 'aria-hidden': 'true', dir: 'ltr' }, o.keyHint));
  if (icon && !o.iconEnd) btn.appendChild(icon);
  if (!o.iconOnly) btn.appendChild(h('span', { class: 'tk-btn__label' }, o.label));
  if (icon && o.iconEnd) btn.appendChild(icon);
  if (o.onClick) btn.addEventListener('click', o.onClick);
  return btn;
}
