export type Preset = 'best' | '1080p' | '720p' | 'mp3' | 'm4a';
export type DownloadState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type EngineErrorCode = 'unsupported' | 'blocked' | 'network' | 'outdated' | 'disk' | 'unknown';

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export interface FormatInfo {
  id: string;
  ext: string;
  height: number | null;
  abr: number | null;
  filesize: number | null;
}

export interface ProbeResult {
  url: string;
  title: string;
  thumbnail: string | null;
  durationSec: number | null;
  formats: FormatInfo[];
}

export interface DownloadItem {
  id: string;
  url: string;
  title: string;
  preset: Preset;
  state: DownloadState;
  percent: number;
  speedBps: number | null;
  etaSec: number | null;
  filePath: string | null;
  error: EngineError | null;
  /** Picture of the video, added by the app from the link check. Engines do not set it. */
  thumbnail?: string | null;
  /** When the app first saw this download, and when it ended (ms since the epoch). Added by the app, not the engine. */
  startedAt?: number;
  finishedAt?: number;
  /** How long a finished download took, in ms. Kept in the library. */
  tookMs?: number;
}

export interface Engine {
  probe(url: string): Promise<ProbeResult>;
  start(url: string, preset: Preset, destination: string): Promise<string>;
  cancel(id: string): Promise<void>;
  list(): Promise<DownloadItem[]>;
  updateEngine(): Promise<string>;
  onProgress(handler: (item: DownloadItem) => void): () => void;
}
