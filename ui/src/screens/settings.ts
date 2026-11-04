import type { Preset } from '../engine';
import { h } from '../lib/dom';
import { PRESET_LABELS } from '../lib/labels';
import { PRESET_LIST } from '../state/store';
import type { ScreenFactory } from './types';

export const createSettings: ScreenFactory = (store) => {
  const dest = h('output', { testid: 'destination', id: 'destination', class: 'setting-value' });
  const choose = h('button', { type: 'button', testid: 'choose-folder', class: 'button setting-action' }, 'Choose folder');
  choose.hidden = !store.canChooseFolder;
  choose.addEventListener('click', () => void store.chooseFolder());

  const select = h('select', { id: 'default-preset', testid: 'default-preset', class: 'field select-field' });
  for (const p of PRESET_LIST) select.append(h('option', { value: p }, PRESET_LABELS[p]));
  select.addEventListener('change', () => store.setPreset(select.value as Preset));

  const version = h('output', { testid: 'engine-version', id: 'engine-version', class: 'setting-value' });
  const update = h('button', { type: 'button', testid: 'update-engine', class: 'button setting-action' }, 'Update engine');
  update.addEventListener('click', () => void store.updateEngine());

  const el = h(
    'div', { class: 'screen screen-settings' },
    h('h1', { class: 'monument' }, h('span', { class: 'monument-line' }, 'Settings')),
    h('div', { class: 'settings' },
      h('p', { class: 'setting' }, h('label', { for: 'destination', class: 'run-in' }, 'Destination folder: '), dest, ' ', choose),
      h('p', { class: 'setting' }, h('label', { for: 'default-preset', class: 'run-in' }, 'Default quality: '), select),
      h('p', { class: 'setting' }, h('label', { for: 'engine-version', class: 'run-in' }, 'Engine version: '), version, ' ', update),
      h('p', { class: 'setting-note' },
        'Sites change often. When a link that used to work fails, update the engine first.'),
    ),
  );

  function sync(): void {
    const s = store.state.settings;
    dest.textContent = s.destination;
    if (select.value !== s.preset) select.value = s.preset;
    version.textContent = s.engineVersion ?? 'Not checked yet';
  }
  sync();
  return { el, update: sync };
};
