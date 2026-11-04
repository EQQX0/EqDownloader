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

  const appVer = h('output', { testid: 'app-version', id: 'app-version', class: 'setting-value' });
  const appBtn = h('button', { type: 'button', testid: 'app-update', class: 'button setting-action' }, 'Check for app update');
  appBtn.addEventListener('click', () => void (store.state.appUpdate.status === 'available' ? store.installAppUpdate() : store.checkAppUpdate()));
  const appNote = h('span', { testid: 'app-update-note', class: 'setting-note' });
  const appRow = h('p', { class: 'setting' }, h('label', { for: 'app-version', class: 'run-in' }, 'App version: '), appVer, ' ', appBtn, ' ', appNote);
  appRow.hidden = !store.canUpdateApp;

  const support = h('button', { type: 'button', testid: 'support', class: 'button setting-action coffee' }, 'Buy me a coffee');
  support.addEventListener('click', () => void store.openSupport());
  const supportRow = h('p', { class: 'setting' }, 'Free, no ads. If it helps you: ', support);
  supportRow.hidden = !store.canOpenSupport;

  const logBox = h('pre', { testid: 'debug-text', class: 'debug-text' });
  logBox.hidden = true;
  const logShow = h('button', { type: 'button', testid: 'debug-show', class: 'button setting-action' }, 'Show debug log');
  const logCopy = h('button', { type: 'button', testid: 'debug-copy', class: 'button setting-action' }, 'Copy');
  const logClear = h('button', { type: 'button', testid: 'debug-clear', class: 'button setting-action' }, 'Clear');
  const logNote = h('span', { class: 'setting-note' });
  logCopy.hidden = logClear.hidden = true;
  let logText = '';
  logShow.addEventListener('click', async () => {
    if (!logBox.hidden) {
      logBox.hidden = logCopy.hidden = logClear.hidden = true;
      logShow.textContent = 'Show debug log';
      return;
    }
    logText = await store.debugLog();
    logBox.textContent = logText;
    logBox.hidden = logCopy.hidden = logClear.hidden = false;
    logShow.textContent = 'Hide debug log';
  });
  logCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(logText);
      logNote.textContent = 'Copied.';
    } catch {
      logNote.textContent = 'Could not copy. Select the text and copy it.';
    }
  });
  logClear.addEventListener('click', async () => {
    await store.clearDebugLog();
    logText = await store.debugLog();
    logBox.textContent = logText;
    logNote.textContent = 'Cleared.';
  });
  const debugRow = h('div', { class: 'setting' }, 'Debug log: ', logShow, ' ', logCopy, ' ', logClear, ' ', logNote, logBox);

  const el = h(
    'div', { class: 'screen screen-settings' },
    h('h1', { class: 'monument' }, h('span', { class: 'monument-line' }, 'Settings')),
    h('div', { class: 'settings' },
      h('p', { class: 'setting' }, h('label', { for: 'destination', class: 'run-in' }, 'Destination folder: '), dest, ' ', choose),
      h('p', { class: 'setting' }, h('label', { for: 'default-preset', class: 'run-in' }, 'Default quality: '), select),
      h('p', { class: 'setting' }, h('label', { for: 'engine-version', class: 'run-in' }, 'Engine version: '), version, ' ', update),
      appRow,
      supportRow,
      debugRow,
      h('p', { class: 'setting-note' },
        'Sites change often. When a link that used to work fails, update the engine first.'),
      h('p', { class: 'setting-note' },
        'Fast downloads: each file is split into parts fetched over 8 connections at once, and streamed videos fetch 4 fragments at a time. Your connection and the site still set the top speed.'),
    ),
  );

  function sync(): void {
    const s = store.state.settings;
    dest.textContent = s.destination;
    if (select.value !== s.preset) select.value = s.preset;
    version.textContent = s.engineVersion ?? 'Not checked yet';
    appVer.textContent = s.appVersion ?? 'Unknown';
    const u = store.state.appUpdate;
    appBtn.disabled = u.status === 'checking' || u.status === 'installing' || u.status === 'installed';
    appBtn.classList.toggle('button-install', u.status === 'available');
    appBtn.textContent = u.status === 'available' ? `Install ${u.version}` : u.status === 'checking' ? 'Checking...' : 'Check for app update';
    appNote.textContent =
      u.status === 'current' ? 'You have the newest version.'
      : u.status === 'available' ? `Version ${u.version} is available.`
      : u.status === 'installing' ? 'Downloading and checking the update...'
      : u.status === 'installed' ? 'Update downloaded and checked. Follow the prompt to finish.'
      : '';
  }
  sync();
  return { el, update: sync };
};
