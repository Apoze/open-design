import { build } from 'esbuild';

await build({
  bundle: true,
  entryPoints: {
    index: './src/index.ts',
    startup: './src/startup.ts',
  },
  format: 'esm',
  outdir: './dist',
  packages: 'external',
  platform: 'node',
  target: 'node24',
});
