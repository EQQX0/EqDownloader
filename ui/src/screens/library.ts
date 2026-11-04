import type { DownloadItem } from '../engine';
import { safeImageSrc } from '../lib/image';
import { h } from '../lib/dom';
import type { ScreenFactory } from './types';

export const createLibrary: ScreenFactory = (store) => {
  const empty = h('p', { class: 'lead empty' }, 'No finished downloads yet.');
  const list = h('ul', { 'aria-label': 'Finished downloads', class: 'shelf' });
  const el = h('div', { class: 'screen screen-library' }, h('h1', { class: 'monument' }, h('span', { class: 'monument-line' }, 'Library')), empty, list);
  let key = '';

  function row(item: DownloadItem): HTMLLIElement {
    const open = h('button', { type: 'button', testid: 'item-open', class: 'button file-action' }, 'Show');
    open.hidden = !store.canReveal || !item.filePath;
    open.addEventListener('click', () => {
      if (item.filePath) void store.revealFile(item.filePath);
    });
    const pic = safeImageSrc(item.thumbnail);
    const thumb = h('img', { alt: '', width: '56', height: '56', class: 'file-thumb' });
    if (pic) thumb.src = pic;
    const title = h('strong', { class: 'file-title', title: item.title }, item.title);
    return h(
      'li',
      { testid: `item-${item.id}`, class: 'file' },
      thumb,
      h('div', { class: 'file-main' }, title, h('span', { class: 'file-state', testid: 'item-state' }, 'Done')),
      open,
    );
  }

  function update(): void {
    const done = store.state.items.filter((i) => i.state === 'done');
    empty.hidden = done.length > 0;
    const next = JSON.stringify(done.map((i) => [i.id, i.title, i.filePath, i.thumbnail]));
    if (next === key) return;
    key = next;
    list.replaceChildren(...done.map(row));
  }

  update();
  return { el, update };
};
