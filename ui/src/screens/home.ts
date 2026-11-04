import type { Preset } from '../engine';
import { clampedText } from '../lib/clamp';
import { h } from '../lib/dom';
import { safeImageSrc } from '../lib/image';
import { PRESET_LABELS } from '../lib/labels';
import { titleLength } from '../lib/meter';
import { PRESET_LIST } from '../state/store';
import type { ScreenFactory } from './types';

export const createHome: ScreenFactory = (store) => {
  const input = h('input', {
    id: 'link', name: 'link', type: 'text', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Paste a link', testid: 'link-input', class: 'field link-field',
    'aria-describedby': 'link-hint error-text',
  });
  const submit = h('button', { type: 'submit', testid: 'link-submit', class: 'button check' }, 'Check link');
  const pasteBtn = h('button', { type: 'button', testid: 'paste-button', class: 'button paste' }, 'Paste');
  const form = h(
    'form', { novalidate: true, class: 'link-form' },
    h('label', { for: 'link', class: 'field-label' }, 'Link'), input, h('div', { class: 'link-actions' }, pasteBtn, submit),
  );
  // Paste always checks the link too. If the clipboard cannot be read, the field is focused for a manual paste.
  pasteBtn.addEventListener('click', async () => {
    const text = (await store.readClipboard()).trim();
    if (!text) {
      input.focus();
      return;
    }
    input.value = text;
    void store.submitLink(text);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void store.submitLink(input.value);
  });
  // A paste is a request to check the link: wait for the pasted text to land in the field.
  input.addEventListener('paste', () => {
    setTimeout(() => void store.submitLink(input.value), 0);
  });

  const busy = h('p', { role: 'status', class: 'busy' });
  const result = h('section', { 'aria-labelledby': 'probe-heading', class: 'probe' });
  const el = h(
    'div', { class: 'screen screen-home' },
    h('h1', { class: 'monument' }, h('span', { class: 'monument-line' }, 'Download')),
    h('p', { class: 'lead intro', id: 'link-hint' }, 'Paste a link to a video page. Keep the video, or only its sound.'),
    form, busy, result,
  );

  let selected: Preset | null = null;
  let shownUrl: string | null = null;
  const buttons = new Map<Preset, HTMLButtonElement>();
  const titleText = clampedText();
  const title = h('h2', { id: 'probe-heading', testid: 'probe-title', class: 'probe-title' }, titleText.el);
  const thumb = h('img', { alt: '', width: '160', class: 'probe-thumb' });
  const presetGroup = h('div', { role: 'group', 'aria-label': 'Quality', class: 'presets' });
  const start = h('button', { type: 'button', testid: 'start-button', class: 'button button-primary start' }, 'Download');

  function sync(): void {
    for (const [p, b] of buttons) b.setAttribute('aria-pressed', String(p === selected));
  }

  for (const p of PRESET_LIST) {
    const b = h('button', { type: 'button', testid: `preset-${p}`, 'aria-pressed': 'false', class: 'preset' }, PRESET_LABELS[p]);
    b.addEventListener('click', () => {
      selected = p;
      sync();
    });
    buttons.set(p, b);
    presetGroup.append(b);
  }
  start.addEventListener('click', () => {
    if (selected) void store.startDownload(selected);
  });
  result.append(title, thumb, presetGroup, start);

  function update(): void {
    const { probe, probing, settings } = store.state;
    busy.textContent = probing ? 'Checking link…' : '';
    form.setAttribute('aria-busy', String(probing));
    result.hidden = !probe;
    if (!probe) {
      shownUrl = null;
      return;
    }
    if (!input.value.trim()) input.value = probe.url;
    titleText.set(probe.title);
    title.dataset.length = titleLength(probe.title);
    const img = safeImageSrc(probe.thumbnail);
    if (img) {
      thumb.setAttribute('src', img);
      thumb.hidden = false;
    } else {
      thumb.removeAttribute('src');
      thumb.hidden = true;
    }
    result.classList.toggle('has-thumb', !thumb.hidden);
    if (shownUrl !== probe.url) {
      shownUrl = probe.url;
      selected = settings.preset;
      sync();
    }
  }

  update();
  return { el, update };
};
