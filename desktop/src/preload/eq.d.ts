import type { Engine } from '@eq/ui/engine';

export type EqBridge = Engine & {
  appVersion(): Promise<string>;
  checkAppUpdate(): Promise<{ version: string } | null>;
  installAppUpdate(): Promise<string>;
  getDefaultFolder(): Promise<string>;
  chooseFolder(): Promise<string | null>;
  revealFile(path: string): Promise<void>;
  openSupport(): Promise<void>;
};

declare global {
  interface Window {
    eq: EqBridge;
  }
}
