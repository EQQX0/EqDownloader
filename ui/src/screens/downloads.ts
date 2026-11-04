import type { DownloadItem } from '../engine';
import { safeImageSrc } from '../lib/image';
import { h } from '../lib/dom';
import { formatDuration, formatEta, formatPercent, formatSpeed } from '../lib/format';
import { STATE_LABELS } from '../lib/labels';
import { createMeter, type Meter } from '../lib/meter';
import { describeError } from '../state/errors';
import type { ScreenFactory } from './types';

interface Row {
  li: HTMLLIElement;
  title: HTMLElement;
  thumb: HTMLImageElement;
  state: HTMLElement;
  percent: HTMLElement;
  bar: HTMLProgressElement;
  meter: Meter;
  detail: HTMLElement;
  speed: HTMLElement;
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
    const title = h('strong', { class: 'job-title', id: titleId });
    const thumb = h('img', { alt: '', width: '56', height: '56', class: 'job-thumb' });
    const state = h('span', { testid: 'item-state', class: 'job-state' });
    const percent = h('span', { testid: 'item-percent', class: 'job-percent' });
    const bar = h('progress', { max: '100', value: '0', 'aria-labelledby': titleId, class: 'visually-hidden' });
    const meter = createMeter('job-meter');
    const speed = h('span', { class: 'job-speed' });
    const detail = h('span', { class: 'job-detail' });
    const error = h('span', { testid: 'item-error', class: 'job-error' });
    const cancel = h('button', { type: 'button', testid: 'item-cancel', class: 'button job-action', 'aria-label': 'Cancel', title: 'Cancel' }, '✕');
    const retry = h('button', { type: 'button', testid: 'item-retry', class: 'button job-action', 'aria-label': 'Retry', title: 'Retry' }, '↻');
    cancel.addEventListener('click', () => void store.cancel(item.id));
    retry.addEventListener('click', () => void store.retry(item.id));
    const status = h('span', { class: 'job-status' }, state, percent, speed, detail, error);
    const li = h(
      'li', { testid: `item-${item.id}`, class: 'job' },
      thumb, h('div', { class: 'job-main' }, title, status, bar, meter.el), cancel, retry,
    );
    return { li, title, thumb, state, percent, bar, meter, detail, speed, error, cancel, retry };
  }

  function update(): void {
    const { settings } = store.state;
    // Only what is downloading now, then the one last download.
    const isActive = (i: DownloadItem): boolean => i.state === 'queued' || i.state === 'running';
    const last = store.state.items.filter((i) => !isActive(i)).at(-1);
    const items = [...store.state.items.filter(isActive), ...(last ? [last] : [])];
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
      row.title.title = item.title;
      const pic = safeImageSrc(item.thumbnail);
      if (pic) row.thumb.src = pic;
      else row.thumb.removeAttribute('src');
      row.state.textContent = STATE_LABELS[item.state];
      row.percent.textContent = item.state === 'running' || item.state === 'queued' ? formatPercent(item.percent) : '';
      row.bar.value = Number.isFinite(item.percent) ? Math.min(100, Math.max(0, item.percent)) : 0;
      row.meter.set(row.bar.value);
      row.li.dataset.state = item.state;
      const elapsed = (item.tookMs ?? Date.now() - (item.startedAt ?? Date.now())) / 1000;
      row.speed.textContent = item.state === 'running' ? formatSpeed(item.speedBps) : '';
      row.detail.textContent =
        item.state === 'running'
          ? `${formatDuration(elapsed)} · ~${formatEta(item.etaSec)}`
          : item.state === 'queued'
            ? formatDuration(elapsed)
            : item.state === 'done' && item.tookMs !== undefined
              ? `took ${formatDuration(elapsed)}`
              : '';
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
