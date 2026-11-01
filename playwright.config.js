import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

const headed = process.env.GIS_TEST_HEADED === '1';

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
        baseURL: 'http://127.0.0.1:5175',
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
            url: 'http://127.0.0.1:5175',
            reuseExistingServer: true,
            timeout: 360_000
        },
        {
            command: 'node tests/mocks/arcgis-mock-server.mjs',
            url: 'http://127.0.0.1:18765/health',
            reuseExistingServer: true,
            timeout: 60_000,
            env: {
                ...process.env,
                ARCGIS_MOCK_PORT: '18765',
                ARCGIS_MOCK_HOST: '127.0.0.1'
            }
        }
    ]
});
