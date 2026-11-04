import { FakeEngine } from './fake';
import type { Engine } from './types';

/** Extra methods only the desktop shell provides. */
export interface DesktopExtras {
  getDefaultFolder(): Promise<string>;
  chooseFolder(): Promise<string | null>;
  revealFile(path: string): Promise<void>;
}

type MaybeBridge = Engine & Partial<DesktopExtras>;

/** The shell's engine (`window.eq`) when present, else the fake one for browser use and tests. Task 7 adds Capacitor here. */
export function getEngine(): Engine {
  const bridge = (globalThis as { eq?: MaybeBridge }).eq;
  return bridge ?? new FakeEngine({ delayMs: 400 });
}

/** Platform extras of an engine; each one is absent on the fake or mobile engines. */
export function hostFor(engine: Engine): Partial<DesktopExtras> {
  const e = engine as MaybeBridge;
  const out: Partial<DesktopExtras> = {};
  if (typeof e.getDefaultFolder === 'function') out.getDefaultFolder = () => e.getDefaultFolder!();
  if (typeof e.chooseFolder === 'function') out.chooseFolder = () => e.chooseFolder!();
  if (typeof e.revealFile === 'function') out.revealFile = (p) => e.revealFile!(p);
  return out;
}
