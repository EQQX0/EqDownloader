import type { EngineError, EngineErrorCode } from '../engine';

export interface UiError {
  code: EngineErrorCode | 'nolink';
  message: string;
  /** Show the Update engine action. */
  offerUpdate: boolean;
  /** Show the Choose folder action (the saved destination is no longer allowed). */
  offerChoose?: boolean;
  /** The site wants a signed-in account. Settings has the Accounts rows that fix it. */
  needsLogin?: boolean;
}

const LOGIN_NEEDED = /log ?in|sign in|authentication|--cookies|cookies-from-browser|cookies for the authentication/i;

export const NO_LINK: UiError = { code: 'nolink', message: 'No link found.', offerUpdate: false };

/** Maps an engine error to the user-facing message from the spec's Errors table. */
export function describeError(err: EngineError, destination: string): UiError {
  switch (err.code) {
    case 'unsupported':
      return { code: err.code, message: 'This site is not supported.', offerUpdate: true };
    case 'outdated':
      return { code: err.code, message: 'The download engine is out of date.', offerUpdate: true };
    case 'network':
      return { code: err.code, message: 'No network connection.', offerUpdate: false };
    case 'disk':
      return { code: err.code, message: `Cannot write to the destination: ${destination}.`, offerUpdate: false };
    case 'blocked':
      if (LOGIN_NEEDED.test(err.message)) {
        return {
          code: err.code,
          message: 'This link needs a login. Open Settings, sign in to the site under Accounts, then try again.',
          offerUpdate: false,
          needsLogin: true,
        };
      }
      return { code: err.code, message: err.message || 'Something went wrong.', offerUpdate: false };
    case 'unknown':
    default:
      return { code: err.code, message: err.message || 'Something went wrong.', offerUpdate: false };
  }
}

/** Anything thrown by an engine, normalised to an EngineError. */
export function asEngineError(e: unknown): EngineError {
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; message?: unknown };
    const codes: EngineErrorCode[] = ['unsupported', 'blocked', 'network', 'outdated', 'disk', 'unknown'];
    return {
      code: codes.includes(o.code as EngineErrorCode) ? (o.code as EngineErrorCode) : 'unknown',
      message: typeof o.message === 'string' && o.message ? o.message : 'Something went wrong.',
    };
  }
  return { code: 'unknown', message: typeof e === 'string' && e ? e : 'Something went wrong.' };
}
