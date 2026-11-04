import type { Store } from '../state/store';

export interface ScreenView {
  el: HTMLElement;
  /** Re-sync the DOM with the store without rebuilding it, so focus and typed text survive. */
  update(): void;
}

export type ScreenFactory = (store: Store) => ScreenView;
