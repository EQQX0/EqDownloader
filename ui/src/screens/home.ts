import type { Preset } from '../engine';
import { h } from '../lib/dom';
import { PRESET_LABELS } from '../lib/labels';
import { PRESET_LIST } from '../state/store';
import type { ScreenFactory } from './types';

export const createHome: ScreenFactory = (store) => {
  const input = h('input', {
    id: 'link', name: 'link', type: 'text', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Paste a link', testid: 'link-input',
  });
  const submit = h('button', { type: 'submit', testid: 'link-submit' }, 'Check link');
  const form = h('form', { novalidate: true }, h('label', { for: 'link' }, 'Link'), input, submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void store.submitLink(input.value);
  });
  // A paste is a request to check the link: wait for the pasted text to land in the field.
  input.addEventListener('paste', () => {
    setTimeout(() => void store.submitLink(input.value), 0);
  });

  const busy = h('p', { role: 'status' });
  const result = h('section', { 'aria-labelledby': 'probe-heading' });
  const el = h('div', {}, h('h1', {}, 'Download'), form, busy, result);

  let selected: Preset | null = null;
  let shownUrl: string | null = null;
  const buttons = new Map<Preset, HTMLButtonElement>();
  const title = h('h2', { id: 'probe-heading', testid: 'probe-title' });
  const thumb = h('img', { alt: '', width: '160' });
  const presetGroup = h('div', { role: 'group', 'aria-label': 'Quality' });
  const start = h('button', { type: 'button', testid: 'start-button' }, 'Download');

  function sync(): void {
    for (const [p, b] of buttons) b.setAttribute('aria-pressed', String(p === selected));
  }

  for (const p of PRESET_LIST) {
    const b = h('button', { type: 'button', testid: `preset-${p}`, 'aria-pressed': 'false' }, PRESET_LABELS[p]);
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
    result.hidden = !probe;
    if (!probe) {
      shownUrl = null;
      return;
    }
    title.textContent = probe.title;
    if (probe.thumbnail) {
      thumb.setAttribute('src', probe.thumbnail);
      thumb.hidden = false;
    } else {
      thumb.removeAttribute('src');
      thumb.hidden = true;
    }
    if (shownUrl !== probe.url) {
      shownUrl = probe.url;
      selected = settings.preset;
      sync();
    }
  }

  update();
  return { el, update };
};
