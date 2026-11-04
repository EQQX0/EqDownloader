import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'info',
};

await build({ ...common, entryPoints: [path.join(root, 'src/main/main.ts')], outfile: path.join(root, 'out/main.cjs') });
await build({ ...common, entryPoints: [path.join(root, 'src/main/preload.ts')], outfile: path.join(root, 'out/preload.cjs') });
