import { Capacitor } from '@capacitor/core';
import { CapacitorEngine } from './capacitor';
import { FakeEngine } from './fake';
import type { Engine } from './types';

/** Extra methods only the desktop shell provides. */
export interface AppUpdater {
  version(): Promise<string>;
  /** The newer version number, or null when this build is current. */
  check(): Promise<{ version: string } | null>;
  install(): Promise<string>;
}

export interface DesktopExtras {
  getDefaultFolder(): Promise<string>;
  chooseFolder(): Promise<string | null>;
  revealFile(path: string): Promise<void>;
  /** Opens the support page in the system browser. The address is fixed in the shell, not passed in. */
  openSupport(): Promise<void>;
  readDebugLog(): Promise<string>;
  clearDebugLog(): Promise<void>;
  appUpdater: AppUpdater;
}

type AppBridge = { appVersion(): Promise<string>; checkAppUpdate(): Promise<{ version: string } | null>; installAppUpdate(): Promise<string> };
type MaybeBridge = Engine & Partial<Omit<DesktopExtras, 'appUpdater'>> & Partial<AppBridge>;

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
  if (typeof e.openSupport === 'function') out.openSupport = () => e.openSupport!();
  if (typeof e.readDebugLog === 'function') out.readDebugLog = () => e.readDebugLog!();
  if (typeof e.clearDebugLog === 'function') out.clearDebugLog = () => e.clearDebugLog!();
  if (typeof e.appVersion === 'function' && typeof e.checkAppUpdate === 'function' && typeof e.installAppUpdate === 'function') {
    out.appUpdater = { version: () => e.appVersion!(), check: () => e.checkAppUpdate!(), install: () => e.installAppUpdate!() };
  }
  return out;
}
