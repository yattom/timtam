import { defineConfig } from 'vite';

// Workaround for libraries expecting Node globals in the browser (e.g., amazon-chime-sdk-js or transitive deps)
// See: https://vitejs.dev/guide/dep-pre-bundling.html#polyfill-node-globals
export default defineConfig({
  define: {
    // Some deps reference `global` (Node). Map it to `window` in browser.
    global: 'window',
    // Guard against `process.env` lookups in browser bundles.
    'process.env': {},
  },
});
