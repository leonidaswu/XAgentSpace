import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

await mkdir(path.join(root, 'dist/public'), { recursive: true });
await mkdir(path.join(root, 'dist/server'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'apps/server/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(root, 'dist/server/index.cjs'),
  sourcemap: true,
  packages: 'external',
  logLevel: 'info'
});

await copyFile(path.join(root, 'apps/web/index.html'), path.join(root, 'dist/public/index.html'));
await copyFile(path.join(root, 'apps/web/styles.css'), path.join(root, 'dist/public/styles.css'));

await build({
  entryPoints: [path.join(root, 'apps/web/src/main.tsx')],
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  outfile: path.join(root, 'dist/public/app.js'),
  sourcemap: true,
  loader: {
    '.ts': 'ts',
    '.tsx': 'tsx'
  },
  logLevel: 'info'
});
