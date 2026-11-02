import { cx, h, nextId, uiText, type Child } from './dom';
import { tkButton } from './button';

export interface DialogOptions {
  title: string;
  /** Optional typewriter eyebrow above the title. */
  eyebrow?: string;
  body: Child | Child[];
  /** Action buttons, in reading order (first = primary, sits at inline-start). */
  actions?: HTMLElement[];
  /** 'slate' = system dialog, 'paper' = in-world card (check overlay, memo). */
  tone?: 'slate' | 'paper';
  /** Show the close (X) button. Default true. Esc always closes unless `modalLocked`. */
  closable?: boolean;
  /** Red-check "no going back" moments: Esc and backdrop do nothing; an explicit action is required. */
  modalLocked?: boolean;
  onClose?: (returnValue: string) => void;
}

export interface DialogHandle {
  el: HTMLDialogElement;
  open(): void;
  close(returnValue?: string): void;
}

/** Native <dialog> + showModal: focus trap, inert background and Esc for free. */
export function tkDialog(o: DialogOptions): DialogHandle {
  const titleId = nextId('tk-dlg-title');
  const tone = o.tone ?? 'slate';
  const el = h('dialog', { class: cx('tk-dialog', `tk-dialog--${tone}`), 'aria-labelledby': titleId });
  const header = h(
    'header',
    { class: 'tk-dialog__header' },
    h(
      'div',
      { class: 'tk-dialog__heading' },
      o.eyebrow ? h('p', { class: 'tk-dialog__eyebrow' }, o.eyebrow) : null,
      h('h2', { class: 'tk-dialog__title', id: titleId }, o.title),
    ),
  );
  if (o.closable !== false && !o.modalLocked) {
    header.appendChild(
      tkButton({ label: uiText('tk.close'), icon: 'close', iconOnly: true, variant: 'ghost', onClick: () => handle.close('close') }),
    );
  }
  const body = Array.isArray(o.body) ? o.body : [o.body];
  el.append(header, h('div', { class: 'tk-dialog__body' }, ...body));
  if (o.actions?.length) el.appendChild(h('footer', { class: 'tk-dialog__actions' }, ...o.actions));

  let opener: Element | null = null;
  el.addEventListener('cancel', (e) => {
    if (o.modalLocked) e.preventDefault();
  });
  el.addEventListener('click', (e) => {
    // Backdrop click: the event target is the dialog itself (content fills the box).
    if (e.target === el && !o.modalLocked && o.closable !== false) handle.close('backdrop');
  });
  el.addEventListener('close', () => {
    o.onClose?.(el.returnValue);
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  });

  const handle: DialogHandle = {
    el,
    open() {
      if (!el.isConnected) document.body.appendChild(el);
      opener = document.activeElement;
      el.showModal();
    },
    close(returnValue = '') {
      if (el.open) el.close(returnValue);
    },
  };
  return handle;
}
