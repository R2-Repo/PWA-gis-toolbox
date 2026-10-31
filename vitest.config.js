import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        include: ['tests/**/*.test.js'],
        environment: 'node',
        setupFiles: ['tests/setup/network-block.js'],
        testTimeout: 20_000
    }
});
