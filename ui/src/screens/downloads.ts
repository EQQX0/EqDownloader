import type { DownloadItem } from '../engine';
import { clampedText, type ClampedText } from '../lib/clamp';
import { h } from '../lib/dom';
import { formatEta, formatPercent, formatSpeed } from '../lib/format';
import { STATE_LABELS } from '../lib/labels';
import { createMeter, type Meter } from '../lib/meter';
import { describeError } from '../state/errors';
import type { ScreenFactory } from './types';

interface Row {
  li: HTMLLIElement;
  title: HTMLElement;
  titleText: ClampedText;
  state: HTMLElement;
  percent: HTMLElement;
  bar: HTMLProgressElement;
  meter: Meter;
  detail: HTMLElement;
  error: HTMLElement;
  cancel: HTMLButtonElement;
  retry: HTMLButtonElement;
}

export const createDownloads: ScreenFactory = (store) => {
  const empty = h('p', { class: 'lead empty' }, 'No downloads yet.');
  const list = h('ol', { 'aria-label': 'Downloads', class: 'queue' });
  const el = h('div', { class: 'screen screen-downloads' }, h('h1', { class: 'monument' }, h('span', { class: 'monument-line' }, 'Downloads')), empty, list);
  const rows = new Map<string, Row>();

  function build(item: DownloadItem): Row {
    // Each job's progress bar is named by its own title, so a screen reader can tell jobs apart.
    const titleId = `job-title-${item.id.replace(/[^\w-]/g, '_')}`;
    const titleText = clampedText();
    const title = h('strong', { class: 'job-title', id: titleId }, titleText.el);
    const state = h('span', { testid: 'item-state', class: 'job-state' });
    const percent = h('span', { testid: 'item-percent', class: 'job-percent' });
    const bar = h('progress', { max: '100', value: '0', 'aria-labelledby': titleId, class: 'visually-hidden' });
    const meter = createMeter('job-meter');
    const detail = h('span', { class: 'job-detail' });
    const error = h('p', { testid: 'item-error', class: 'job-error' });
    const cancel = h('button', { type: 'button', testid: 'item-cancel', class: 'button job-action' }, 'Cancel');
    const retry = h('button', { type: 'button', testid: 'item-retry', class: 'button job-action' }, 'Retry');
    cancel.addEventListener('click', () => void store.cancel(item.id));
    retry.addEventListener('click', () => void store.retry(item.id));
    const li = h(
      'li', { testid: `item-${item.id}`, class: 'job' },
      title, ' ', state, ' ', percent, bar, meter.el, detail, error, cancel, retry,
    );
    return { li, title, titleText, state, percent, bar, meter, detail, error, cancel, retry };
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
      row.titleText.set(item.title);
      row.state.textContent = STATE_LABELS[item.state];
      row.percent.textContent = formatPercent(item.percent);
      row.bar.value = Number.isFinite(item.percent) ? Math.min(100, Math.max(0, item.percent)) : 0;
      row.meter.set(row.bar.value);
      row.li.dataset.state = item.state;
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
