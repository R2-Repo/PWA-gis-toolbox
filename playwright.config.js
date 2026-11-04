import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

const headed = process.env.GIS_TEST_HEADED === '1';
const GIS_TEST_PORT = String(process.env.GIS_TEST_PORT || '5175');
const ARCGIS_MOCK_PORT = String(process.env.ARCGIS_MOCK_PORT || '18765');
const reuseExistingServer = GIS_TEST_PORT === '5175' && ARCGIS_MOCK_PORT === '18765';
const appOrigin = `http://127.0.0.1:${GIS_TEST_PORT}`;
const mockOrigin = `http://127.0.0.1:${ARCGIS_MOCK_PORT}`;

/** @type {import('@playwright/test').PlaywrightTestConfig} */
export default defineConfig({
    testDir: join(repoRoot, 'tests/e2e'),
    outputDir: join(repoRoot, 'test-results/playwright-output'),
    fullyParallel: true,
    workers: process.env.CI ? 2 : 4,
    forbidOnly: !!process.env.CI,
    retries: 1,
    reporter: [
        ['list'],
        ['json', { outputFile: join(repoRoot, 'test-results/gis-report/playwright.json') }],
        ['html', { outputFolder: join(repoRoot, 'test-results/gis-report/playwright-html'), open: 'never' }]
    ],
    use: {
        baseURL: appOrigin,
        headless: !headed,
        trace: 'retain-on-failure',
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'block',
        acceptDownloads: true
    },
    projects: [{
        name: 'chromium',
        use: {
            ...devices['Desktop Chrome'],
            ...(process.env.PLAYWRIGHT_CHROME_PATH
                ? {
                    launchOptions: {
                        executablePath: process.env.PLAYWRIGHT_CHROME_PATH
                    }
                }
                : {})
        }
    }],
    webServer: [
        {
            command: 'node scripts/e2e-web-server.mjs',
            url: appOrigin,
            reuseExistingServer,
            timeout: 360_000,
            env: {
                ...process.env,
                GIS_TEST_PORT
            }
        },
        {
            command: 'node tests/mocks/arcgis-mock-server.mjs',
            url: `${mockOrigin}/health`,
            reuseExistingServer,
            timeout: 60_000,
            env: {
                ...process.env,
                ARCGIS_MOCK_PORT,
                ARCGIS_MOCK_HOST: '127.0.0.1'
            }
        }
    ]
});
