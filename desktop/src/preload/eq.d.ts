import type { Engine } from '@eq/ui/engine';

export type EqBridge = Engine & {
  chooseFolder(): Promise<string | null>;
  revealFile(path: string): Promise<void>;
};

declare global {
  interface Window {
    eq: EqBridge;
  }
}
