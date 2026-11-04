import { h } from './dom';

/**
 * Title text clamped to two lines. When the clamp actually cuts the text, the span becomes a toggle
 * (role=button, focusable, aria-expanded) so touch and keyboard users can read the whole title;
 * a title that fits stays plain text with no extra tab stop.
 */
export interface ClampedText {
  el: HTMLSpanElement;
  set(text: string): void;
}

export function clampedText(): ClampedText {
  const el = h('span', { class: 'clamp' });
  let text: string | null = null;

  function toggle(): void {
    if (!el.hasAttribute('role')) return;
    el.setAttribute('aria-expanded', String(el.getAttribute('aria-expanded') !== 'true'));
  }
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  function measure(): void {
    if (el.getAttribute('aria-expanded') === 'true') return;
    // A tight line-height lets descenders overflow by a few pixels; only a hidden line (half a line or more) counts.
    const line = parseFloat(getComputedStyle(el).lineHeight) || 16;
    const cut = el.scrollHeight - el.clientHeight > line / 2;
    if (cut) {
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-expanded', 'false');
    } else {
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
      el.removeAttribute('aria-expanded');
    }
  }

  function set(next: string): void {
    if (next === text) return;
    text = next;
    el.textContent = next;
    el.title = next;
    el.removeAttribute('aria-expanded');
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
  }

  return { el, set };
}
