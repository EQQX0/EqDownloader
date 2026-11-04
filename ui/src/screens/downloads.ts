import type { DownloadItem } from '../engine';
import { h } from '../lib/dom';
import { formatEta, formatPercent, formatSpeed } from '../lib/format';
import { STATE_LABELS } from '../lib/labels';
import { describeError } from '../state/errors';
import type { ScreenFactory } from './types';

interface Row {
  li: HTMLLIElement;
  title: HTMLElement;
  state: HTMLElement;
  percent: HTMLElement;
  bar: HTMLProgressElement;
  detail: HTMLElement;
  error: HTMLElement;
  cancel: HTMLButtonElement;
  retry: HTMLButtonElement;
}

export const createDownloads: ScreenFactory = (store) => {
  const empty = h('p', {}, 'No downloads yet.');
  const list = h('ol', { 'aria-label': 'Downloads' });
  const el = h('div', {}, h('h1', {}, 'Downloads'), empty, list);
  const rows = new Map<string, Row>();

  function build(item: DownloadItem): Row {
    const title = h('strong');
    const state = h('span', { testid: 'item-state' });
    const percent = h('span', { testid: 'item-percent' });
    const bar = h('progress', { max: '100', value: '0', 'aria-label': 'Progress' });
    const detail = h('span');
    const error = h('p', { testid: 'item-error' });
    const cancel = h('button', { type: 'button', testid: 'item-cancel' }, 'Cancel');
    const retry = h('button', { type: 'button', testid: 'item-retry' }, 'Retry');
    cancel.addEventListener('click', () => void store.cancel(item.id));
    retry.addEventListener('click', () => void store.retry(item.id));
    const li = h('li', { testid: `item-${item.id}` }, title, ' ', state, ' ', percent, bar, detail, error, cancel, retry);
    return { li, title, state, percent, bar, detail, error, cancel, retry };
  }

  function update(): void {
    const { items, settings } = store.state;
    empty.hidden = items.length > 0;
    const seen = new Set<string>();
    items.forEach((item, idx) => {
      seen.add(item.id);
      let row = rows.get(item.id);
      if (!row) {
        row = build(item);
        rows.set(item.id, row);
      }
      if (list.children[idx] !== row.li) list.insertBefore(row.li, list.children[idx] ?? null);
      const active = item.state === 'queued' || item.state === 'running';
      row.title.textContent = item.title;
      row.state.textContent = STATE_LABELS[item.state];
      row.percent.textContent = formatPercent(item.percent);
      row.bar.value = Number.isFinite(item.percent) ? Math.min(100, Math.max(0, item.percent)) : 0;
      row.detail.textContent = item.state === 'running' ? ` ${formatSpeed(item.speedBps)} · ETA ${formatEta(item.etaSec)}` : '';
      const msg = item.state === 'failed' && item.error ? describeError(item.error, settings.destination).message : '';
      row.error.textContent = msg;
      row.error.hidden = !msg;
      row.cancel.hidden = !active;
      const noRetry = item.error?.code === 'blocked' || item.error?.code === 'unsupported';
      row.retry.hidden = item.state !== 'failed' || noRetry;
    });
    for (const [id, row] of rows) {
      if (!seen.has(id)) {
        row.li.remove();
        rows.delete(id);
      }
    }
  }

  update();
  return { el, update };
};
