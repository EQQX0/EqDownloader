import type { DownloadItem } from '../engine';
import { h } from '../lib/dom';
import { equalsMark, titleLength } from '../lib/meter';
import type { ScreenFactory } from './types';

export const createLibrary: ScreenFactory = (store) => {
  const empty = h('p', { class: 'lead empty' }, 'No finished downloads yet.');
  const list = h('ul', { 'aria-label': 'Finished downloads', class: 'shelf' });
  const el = h('div', { class: 'screen screen-library' }, h('h1', { class: 'monument' }, h('span', { class: 'monument-line' }, 'Library')), empty, list);
  let key = '';

  function row(item: DownloadItem): HTMLLIElement {
    const open = h('button', { type: 'button', testid: 'item-open', class: 'button file-action' }, 'Show in folder');
    open.hidden = !store.canReveal || !item.filePath;
    open.addEventListener('click', () => {
      if (item.filePath) void store.revealFile(item.filePath);
    });
    return h(
      'li',
      { testid: `item-${item.id}`, class: 'file' },
      h('strong', { class: 'file-title', title: item.title, 'data-length': titleLength(item.title) }, item.title), ' ',
      h('span', { class: 'file-state' }, equalsMark('file-mark'), h('span', { testid: 'item-state' }, 'Done')), ' ',
      h('span', { class: 'file-path' }, item.filePath ?? ''), ' ',
      open,
    );
  }

  function update(): void {
    const done = store.state.items.filter((i) => i.state === 'done');
    empty.hidden = done.length > 0;
    const next = JSON.stringify(done.map((i) => [i.id, i.title, i.filePath]));
    if (next === key) return;
    key = next;
    list.replaceChildren(...done.map(row));
  }

  update();
  return { el, update };
};
