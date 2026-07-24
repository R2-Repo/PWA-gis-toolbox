import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, join } from 'node:path';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';

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
      runtimeCaching: [
        {
          urlPattern: /^https:\/\/(unpkg\.com|cdn\.sheetjs\.com|cdn\.jsdelivr\.net)\//i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'gis-toolbox-cdn-libs',
            expiration: {
              maxEntries: 64,
              maxAgeSeconds: 60 * 60 * 24 * 30
            },
            cacheableResponse: {
              statuses: [0, 200]
            }
          }
        }
      ]
    }
  });
}

export default defineConfig(({ mode }) => {
  const outDir = mode === 'web' ? 'dist-web' : 'dist';

  return {
    base: './',
    envPrefix: ['VITE_'],
    server: {
      port: 5174,
      strictPort: true
    },
    define: {
      'import.meta.env.VITE_GIS_RUNTIME': JSON.stringify('web')
    },
    plugins: [
      react(),
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
