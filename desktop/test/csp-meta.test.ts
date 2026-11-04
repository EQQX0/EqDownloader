import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/main/security';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Asserts an HTML file carries a meta CSP with `default-src 'self'` and no unsafe-eval. Reused for ui/index.html in Task 5. */
export function assertHtmlHasCsp(htmlPath: string): string {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=("([^"]*)"|'([^']*)')/i.exec(html);
  expect(m, `${htmlPath} has no <meta http-equiv="Content-Security-Policy">`).not.toBeNull();
  const csp = m![2] ?? m![3] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).not.toContain('unsafe-eval');
  return csp;
}

describe('meta CSP in shipped HTML', () => {
  it('fallback.html carries a meta CSP', () => {
    assertHtmlHasCsp(path.join(root, 'src', 'renderer', 'fallback.html'));
  });

  const uiIndex = path.resolve(root, '..', 'ui', 'index.html');
  it('ui/index.html carries a meta CSP identical to the header policy', () => {
    expect(fs.existsSync(uiIndex), 'ui/index.html must exist').toBe(true);
    expect(assertHtmlHasCsp(uiIndex)).toBe(contentSecurityPolicy());
  });

  it('ui/index.html has no inline script', () => {
    const html = fs.readFileSync(uiIndex, 'utf8');
    for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
      expect(m[2]!.trim(), 'inline script body').toBe('');
    }
  });
});
