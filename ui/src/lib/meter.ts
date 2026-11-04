import { h } from './dom';

/**
 * The equals-sign meter. The upper bar is the original, always full; the lower bar is the copy on disk and
 * grows until it equals the upper one. Decorative only (the native <progress> and the percent text carry the
 * value for assistive tech). The fill moves by transform through the Web Animations API, so no style
 * attribute is ever written.
 */
export interface Meter {
  el: HTMLElement;
  set(percent: number): void;
}

const reduce = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createMeter(extraClass = ''): Meter {
  const fill = h('span', { class: 'meter-fill' });
  const el = h(
    'span',
    { class: `meter ${extraClass}`.trim(), 'aria-hidden': 'true' },
    h('span', { class: 'meter-bar meter-top' }),
    h('span', { class: 'meter-bar meter-low' }, fill),
  );
  let current = -1;
  let anim: Animation | null = null;

  function set(percent: number): void {
    const p = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
    if (p === current) return;
    const to = `scaleX(${p / 100})`;
    const jump = Math.abs(p - Math.max(current, 0));
    current = p;
    if (typeof fill.animate !== 'function') return;
    // Start from wherever the bar is now (mid-flight included), then drop the old animation.
    const from = anim ? getComputedStyle(fill).transform : 'scaleX(0)';
    const next = fill.animate([{ transform: from === 'none' ? 'scaleX(0)' : from }, { transform: to }], {
      // A big jump (progress reported in few steps) glides over about two seconds instead of snapping.
      duration: reduce() ? 0 : jump >= 30 ? 2200 : jump >= 10 ? 1200 : 700,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards',
    });
    anim?.cancel();
    anim = next;
  }

  return { el, set };
}

/**
 * Titles are whatever the site calls the video, from three words to three hundred characters. Long ones are
 * set a size down so they hold to two lines instead of being cut mid-thought.
 */
export function titleLength(text: string): 'short' | 'long' | 'very-long' {
  const n = [...text].length;
  return n <= 40 ? 'short' : n <= 90 ? 'long' : 'very-long';
}

/** A small static equals mark (two equal bars), used as the Done mark. */
export function equalsMark(extraClass = ''): HTMLElement {
  return h(
    'span',
    { class: `mark ${extraClass}`.trim(), 'aria-hidden': 'true' },
    h('span', { class: 'mark-bar' }),
    h('span', { class: 'mark-bar' }),
  );
}
