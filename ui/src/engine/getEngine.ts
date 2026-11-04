import { Capacitor } from '@capacitor/core';
import { CapacitorEngine } from './capacitor';
import { FakeEngine } from './fake';
import type { Engine } from './types';

/** Extra methods only the desktop shell provides. */
export interface DesktopExtras {
  getDefaultFolder(): Promise<string>;
  chooseFolder(): Promise<string | null>;
  revealFile(path: string): Promise<void>;
}

type MaybeBridge = Engine & Partial<DesktopExtras>;

/** The shell's engine (window.eq) on Electron, the Capacitor plugin engine on Android, else the fake one for browser use and tests. */
export function getEngine(cap: { isNativePlatform(): boolean } = Capacitor): Engine {
  const bridge = (globalThis as { eq?: MaybeBridge }).eq;
  if (bridge) return bridge;
  return cap.isNativePlatform() ? new CapacitorEngine() : new FakeEngine({ delayMs: 400 });
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
