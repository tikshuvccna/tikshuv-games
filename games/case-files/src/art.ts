/** Placeholder art: tiny SVG scenes drawn only with palette tokens (replaced by painted raster art later). */
import { tkIcon, type IconName, type VoiceId } from '@tikshuv/ui';

const NS = 'http://www.w3.org/2000/svg';

export function svg(markup: string, viewBox: string, cls: string, label?: string): SVGSVGElement {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('class', cls);
  el.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  if (label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
  } else el.setAttribute('aria-hidden', 'true');
  el.innerHTML = markup;
  return el;
}

const ACCENTS = ['--cf-amber', '--cf-teal', '--cf-blue', '--cf-olive', '--cf-brass', '--cf-rust'];
function accentFor(id: string): string {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return ACCENTS[n % ACCENTS.length]!;
}

/** Bust placeholder: lamp-lit silhouette in the speaker's accent. */
export function portraitEl(id: string, label: string): HTMLElement {
  const accent = accentFor(id);
  const hat = id.includes('rishon') || id.includes('chief');
  const markup = `
    <defs><radialGradient id="pg-${id}" cx="50%" cy="38%" r="60%"><stop offset="0" stop-color="var(${accent})" stop-opacity=".55"/><stop offset="1" stop-color="var(--cf-ink)" stop-opacity="0"/></radialGradient></defs>
    <rect width="120" height="150" fill="url(#pg-${id})"/>
    <path d="M12 150c2-34 20-52 48-52s46 18 48 52z" fill="var(--cf-slate)" stroke="var(${accent})" stroke-width="1.5"/>
    <path d="M48 98l12 16 12-16" fill="none" stroke="var(--cf-paper)" stroke-width="1.5" stroke-linejoin="round"/>
    <ellipse cx="60" cy="62" rx="22" ry="26" fill="var(--cf-fog-light)" stroke="var(--cf-ink)" stroke-width="1.5"/>
    ${hat ? '<path d="M34 50h52l-6-18H40z" fill="var(--cf-ink)" stroke="var(--cf-brass)" stroke-width="1.5"/>' : '<path d="M38 56c0-18 10-26 22-26s22 8 22 26c-8-8-14-10-22-10s-14 2-22 10z" fill="var(--cf-ink)"/>'}
    <path d="M51 70h4M65 70h4" stroke="var(--cf-ink)" stroke-width="2" stroke-linecap="round"/>
    <path d="M54 82q6 4 12 0" fill="none" stroke="var(--cf-ink)" stroke-width="1.5" stroke-linecap="round"/>`;
  const wrap = document.createElement('div');
  wrap.className = 'cf-portrait';
  wrap.appendChild(svg(markup, '0 0 120 150', 'cf-portrait__art', label));
  return wrap;
}

/** Large voice sigil standing in for an inner voice's portrait. */
export function voiceSigilEl(voice: VoiceId, icon: IconName): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cf-portrait cf-portrait--voice';
  wrap.dataset['voice'] = voice;
  wrap.appendChild(tkIcon(icon, { size: 72, className: 'cf-portrait__sigil' }));
  return wrap;
}

/** Title screen: harbour skyline at night, rain, one lit window. */
export function harbourSkyline(): SVGSVGElement {
  let rain = '';
  for (let i = 0; i < 38; i++) {
    const x = (i * 53) % 400;
    const y = (i * 97) % 160;
    rain += `<path d="M${x} ${y}l-4 14" />`;
  }
  const markup = `
    <rect width="400" height="260" fill="var(--cf-night)"/>
    <circle cx="300" cy="64" r="70" fill="var(--cf-amber)" opacity=".10"/>
    <circle cx="300" cy="64" r="34" fill="var(--cf-amber)" opacity=".10"/>
    <g fill="var(--cf-ink)">
      <rect x="10" y="120" width="46" height="140"/><rect x="62" y="90" width="38" height="170"/>
      <rect x="106" y="140" width="58" height="120"/><rect x="170" y="70" width="44" height="190"/>
      <rect x="220" y="130" width="52" height="130"/><rect x="278" y="100" width="40" height="160"/>
      <rect x="324" y="150" width="66" height="110"/>
    </g>
    <g fill="var(--cf-amber)">
      <rect x="182" y="96" width="8" height="10"/><rect x="72" y="110" width="7" height="9"/>
      <rect x="290" y="124" width="8" height="10"/><rect x="336" y="170" width="7" height="9"/>
    </g>
    <g stroke="var(--cf-fog)" stroke-width="1" opacity=".35" fill="none">${rain}</g>
    <path d="M0 232c40-10 90 8 140 0s100-12 150-2 80 4 110-2v32H0z" fill="var(--cf-slate)" opacity=".8"/>
    <path d="M0 252h400" stroke="var(--cf-brass)" stroke-width="1" opacity=".5"/>`;
  return svg(markup, '0 0 400 260', 'cf-skyline');
}

/** Placeholder inspection scene: a desk, a window with rain, a lamp pool. Hotspots sit on top as buttons. */
export function placeScene(placeId: string): SVGSVGElement {
  const lamp = placeId === 'bureau' ? '--cf-amber' : '--cf-teal';
  const markup = `
    <rect width="400" height="225" fill="var(--cf-night)"/>
    <rect x="0" y="150" width="400" height="75" fill="var(--cf-slate)"/>
    <path d="M0 150h400" stroke="var(--cf-brass)" stroke-width="1" opacity=".6"/>
    <rect x="48" y="26" width="86" height="70" fill="var(--cf-ink)" stroke="var(--cf-brass-deep)" stroke-width="3"/>
    <path d="M91 26v70M48 61h86" stroke="var(--cf-brass-deep)" stroke-width="2"/>
    <g stroke="var(--cf-fog)" stroke-width="1" opacity=".4"><path d="M58 34l-3 9M76 48l-3 9M100 36l-3 9M118 66l-3 9M64 72l-3 9"/></g>
    <ellipse cx="320" cy="168" rx="120" ry="40" fill="var(${lamp})" opacity=".18"/>
    <path d="M338 60l22 0 8 40h-38z" fill="var(--cf-brass)" opacity=".9"/><path d="M349 100v50" stroke="var(--cf-brass-deep)" stroke-width="4"/>
    <rect x="60" y="150" width="280" height="14" fill="var(--cf-brass-deep)"/>
    <rect x="70" y="164" width="10" height="45" fill="var(--cf-brass-deep)"/><rect x="320" y="164" width="10" height="45" fill="var(--cf-brass-deep)"/>
    <rect x="96" y="132" width="52" height="18" fill="var(--cf-paper)" stroke="var(--cf-ink)"/><path d="M96 132l26 12 26-12" fill="none" stroke="var(--cf-fog)"/>
    <rect x="196" y="136" width="30" height="14" fill="var(--cf-blue-deep)"/><circle cx="211" cy="143" r="4" fill="var(--cf-paper)"/>
    <rect x="22" y="104" width="22" height="30" fill="var(--cf-ink)"/><circle cx="33" cy="112" r="3" fill="var(--cf-amber)"/>`;
  return svg(markup, '0 0 400 225', 'cf-place__art');
}
