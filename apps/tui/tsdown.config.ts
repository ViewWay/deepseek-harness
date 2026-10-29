import { defineConfig } from 'tsdown'

/**
 * The TUI application ships its composition entry: declarations come from
 * `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: ['lib/*.js'],
})
