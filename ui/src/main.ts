import './styles/base.css';
import { getEngine, hostFor } from './engine/getEngine';
import { h } from './lib/dom';
import { createDownloads } from './screens/downloads';
import { createHome } from './screens/home';
import { createLibrary } from './screens/library';
import { createSettings } from './screens/settings';
import type { ScreenFactory, ScreenView } from './screens/types';
import { createStore, type Screen } from './state/store';

const engine = getEngine();
const store = createStore(engine, hostFor(engine));

const FACTORIES: Record<Screen, ScreenFactory> = {
  home: createHome,
  downloads: createDownloads,
  library: createLibrary,
  settings: createSettings,
};
const NAV: Array<[Screen, string]> = [
  ['home', 'Home'],
  ['downloads', 'Downloads'],
  ['library', 'Library'],
  ['settings', 'Settings'],
];

const root = document.getElementById('app')!;
const navButtons = new Map<Screen, HTMLButtonElement>();
const navList = h('ul');
for (const [screen, label] of NAV) {
  const b = h('button', { type: 'button', testid: `nav-${screen}` }, label);
  b.addEventListener('click', () => store.go(screen));
  navButtons.set(screen, b);
  navList.append(h('li', {}, b));
}

// State changes are announced through a polite live region; progress ticks are not.
const status = h('div', { role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
const errorText = h('span', { testid: 'error-message' });
const errorUpdate = h('button', { type: 'button', testid: 'update-engine' }, 'Update engine');
errorUpdate.addEventListener('click', () => void store.updateEngine());
const errorChoose = h('button', { type: 'button', testid: 'choose-folder' }, 'Choose folder');
errorChoose.addEventListener('click', () => void store.chooseFolder());
const errorBox = h('div', { role: 'alert', class: 'error' }, errorText);
const main = h('main', { id: 'main' });
root.append(h('nav', { 'aria-label': 'Main' }, navList), errorBox, main, status);

let current: Screen | null = null;
let view: ScreenView | null = null;
const lastState = new Map<string, string>();

function render(): void {
  const { screen, error, items } = store.state;
  if (screen !== current) {
    current = screen;
    view = FACTORIES[screen](store);
    main.replaceChildren(view.el);
    for (const [s, b] of navButtons) {
      if (s === screen) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }
  view!.update();
  errorBox.hidden = !error;
  errorText.textContent = error?.message ?? '';
  // Action buttons are attached only while offered, and never on Settings, which has its own,
  // so each of these test ids exists once at a time.
  const here = screen !== 'settings';
  if (error?.offerUpdate && here) errorBox.append(errorUpdate);
  else errorUpdate.remove();
  if (error?.offerChoose && here) errorBox.append(errorChoose);
  else errorChoose.remove();
  for (const item of items) {
    if (lastState.has(item.id) && lastState.get(item.id) !== item.state) {
      status.textContent = `${item.title}: ${item.state === 'running' ? 'downloading' : item.state}`;
    }
    lastState.set(item.id, item.state);
  }
}

store.subscribe(render);
render();
