import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, join } from 'node:path';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';
import { GTM_HTML_SNIPPET, shouldInjectGtmHtml } from './scripts/gtm-html-snippet.js';
import { PWA_RUNTIME_CACHING } from './js/pwa/runtime-cache.js';

/**
 * Build targets:
 * - default / production → public PWA → dist/
 * - web → public PWA → dist-web/
 */

/** Serve and copy repo-root pipelines/ (example JSON + manifest). */
function pipelinesStaticPlugin(outDir) {
  const root = __dirname;
  return {
    name: 'pipelines-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] || '';
        if (!url.startsWith('/pipelines/')) return next();
        const filePath = join(root, url.slice(1));
        if (!existsSync(filePath)) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(readFileSync(filePath));
      });
    },
    closeBundle() {
      cpSync(join(root, 'pipelines'), join(root, outDir, 'pipelines'), { recursive: true });
    }
  };
}

function inPath(id, segment) {
  return id.includes(`/` + segment + `/`) || id.includes(`\\` + segment + `\\`);
}

function createManualChunks(id) {
  if (!id) return undefined;

  if (inPath(id, 'node_modules')) {
    // Keep React isolated so app-domain ↔ vendor circular imports cannot break jsx-runtime init.
    if (
      inPath(id, 'react-dom') || inPath(id, 'react/') ||
      /[\\/]node_modules[\\/]react[\\/]/.test(id) ||
      inPath(id, 'scheduler')
    ) {
      return 'react-vendor';
    }
    if (inPath(id, 'pdfjs-dist')) {
      return 'pdfjs';
    }
    return 'vendor';
  }

  if (
    inPath(id, 'js/map') || inPath(id, 'js/dual-screen') || inPath(id, 'react/map') ||
    inPath(id, 'js/import') || inPath(id, 'js/export') || inPath(id, 'js/dataprep') ||
    inPath(id, 'js/tools') || inPath(id, 'js/widgets') || inPath(id, 'js/arcgis') ||
    inPath(id, 'js/agol') || inPath(id, 'js/photo') || inPath(id, 'react/tools')
  ) {
    return 'app-domain';
  }

  if (inPath(id, 'react/panels') || inPath(id, 'react/header') || inPath(id, 'react/ui')) {
    return 'app-ui';
  }

  return undefined;
}

function gtmHtmlPlugin(enable) {
  return {
    name: 'gtm-html-inject',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!enable) return html;
        const page = `${ctx?.path || ''} ${ctx?.filename || ''}`.replace(/\\/g, '/');
        if (page.includes('map-window.html')) return html;
        return html.replace('</head>', `${GTM_HTML_SNIPPET}\n</head>`);
      }
    }
  };
}

function createPwaPlugin() {
  return VitePWA({
    registerType: 'autoUpdate',
    injectRegister: 'auto',
    includeAssets: [
      'icons/favicon.png',
      'icons/PWAicon.png',
      'icons/MobileAddButton.png',
      'icons/MobileMenuButton.png',
      'Side_Background.webp',
      '.nojekyll'
    ],
    manifest: {
      name: 'GIS Toolbox',
      short_name: 'GIS Toolbox',
      description: 'Free browser-based GIS toolkit. Import, transform, visualize, and export geospatial data — Shapefile, GeoJSON, KML, KMZ, CSV, Excel & more.',
      start_url: './',
      scope: './',
      id: './',
      display: 'standalone',
      orientation: 'any',
      background_color: '#0f1117',
      theme_color: '#1c1c1e',
      categories: ['utilities', 'productivity'],
      lang: 'en-US',
      icons: [
        {
          src: 'icons/PWAicon.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any'
        },
        {
          src: 'icons/PWAicon.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any'
        },
        {
          src: 'icons/PWAicon.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        },
        {
          src: 'icons/PWAicon.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'maskable'
        }
      ],
      file_handlers: [
        {
          action: './',
          accept: {
            'application/zip': ['.gis-toolbox', '.gtbx'],
            'application/octet-stream': ['.gis-toolbox', '.gtbx']
          }
        }
      ]
    },
    workbox: {
      maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
      // index.html and map-window.html, plus the JS/CSS those entries emit.
      globPatterns: ['**/*.{js,css,html}'],
      runtimeCaching: PWA_RUNTIME_CACHING
    }
  });
}

export default defineConfig(({ mode, command }) => {
  const outDir = mode === 'web' ? 'dist-web' : 'dist';
  const injectGtm = shouldInjectGtmHtml(command, mode);
  const e2eBundle = mode === 'web';

  return {
    base: './',
    envPrefix: ['VITE_'],
    server: {
      port: 5174,
      strictPort: true
    },
    define: {
      'import.meta.env.VITE_GIS_RUNTIME': JSON.stringify('web'),
      ...(e2eBundle ? { 'import.meta.env.VITE_E2E': JSON.stringify('1') } : {})
    },
    plugins: [
      react(),
      gtmHtmlPlugin(injectGtm),
      pipelinesStaticPlugin(outDir),
      createPwaPlugin()
    ],
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          mapWindow: resolve(__dirname, 'map-window.html')
        },
        output: {
          manualChunks: createManualChunks
        }
      }
    }
  };
});
