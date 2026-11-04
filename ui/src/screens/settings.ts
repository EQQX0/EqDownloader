import type { Preset } from '../engine';
import { h } from '../lib/dom';
import { PRESET_LABELS } from '../lib/labels';
import { PRESET_LIST } from '../state/store';
import type { ScreenFactory } from './types';

export const createSettings: ScreenFactory = (store) => {
  const dest = h('output', { testid: 'destination', id: 'destination' });
  const choose = h('button', { type: 'button', testid: 'choose-folder' }, 'Choose folder');
  choose.hidden = !store.canChooseFolder;
  choose.addEventListener('click', () => void store.chooseFolder());

  const select = h('select', { id: 'default-preset', testid: 'default-preset' });
  for (const p of PRESET_LIST) select.append(h('option', { value: p }, PRESET_LABELS[p]));
  select.addEventListener('change', () => store.setPreset(select.value as Preset));

  const version = h('output', { testid: 'engine-version', id: 'engine-version' });
  const update = h('button', { type: 'button', testid: 'update-engine' }, 'Update engine');
  update.addEventListener('click', () => void store.updateEngine());

  const el = h(
    'div', {},
    h('h1', {}, 'Settings'),
    h('p', {}, h('label', { for: 'destination' }, 'Destination folder: '), dest, ' ', choose),
    h('p', {}, h('label', { for: 'default-preset' }, 'Default quality: '), select),
    h('p', {}, h('label', { for: 'engine-version' }, 'Engine version: '), version, ' ', update),
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
