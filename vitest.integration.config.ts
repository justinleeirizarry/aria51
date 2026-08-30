import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Integration tests — these drive a real browser and are excluded from the
 * default `pnpm test` run because they are slow.
 *
 * They must still run in CI. A tab-walk defect is only observable against a
 * real page, so a suite that never executes these cannot catch one.
 */
export default defineConfig({
    resolve: {
        alias: {
            '@aria51/core': resolve(__dirname, 'packages/core/src/index.ts'),
            aria51: resolve(__dirname, 'packages/cli/src/index.tsx'),
            '@aria51/mcp': resolve(__dirname, 'packages/mcp/src/server.ts'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['test/integration/**/*.test.ts'],
        // Browser work is heavy; run files one at a time.
        fileParallelism: false,
        testTimeout: 120000,
        hookTimeout: 120000,
    },
});
