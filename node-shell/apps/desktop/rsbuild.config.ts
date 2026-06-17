import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      index: path.resolve(__dirname, 'renderer-src/src/main.tsx'),
    },
  },
  html: {
    template: path.resolve(__dirname, 'renderer-src/index.html'),
  },
  output: {
    distPath: {
      root: path.resolve(__dirname, 'renderer-dist'),
    },
    cleanDistPath: true,
  },
  tools: {
    rspack: {
      target: 'electron-renderer',
    },
  },
});
