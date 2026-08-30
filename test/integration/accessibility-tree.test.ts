/**
 * Accessibility tree over CDP.
 *
 * Playwright removed `page.accessibility` in 1.62. Because @aria51/core's
 * dependency range is a caret on 1.56, every fresh install resolved to a
 * Playwright without that API and the structure audit threw
 * "Cannot read properties of undefined (reading 'snapshot')". Local checkouts
 * with an older lockfile never saw it.
 *
 * These tests pin the shape the tree must keep, since callers traverse it
 * directly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getAccessibilityTree, type AccessibilityNode } from '../../packages/core/src/utils/accessibility-tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = `file://${join(__dirname, '../fixtures/keyboard-classless-links.html')}`;

function collect(node: AccessibilityNode | null, match: (n: AccessibilityNode) => boolean): AccessibilityNode[] {
    if (!node) return [];
    const found = match(node) ? [node] : [];
    for (const child of node.children ?? []) found.push(...collect(child, match));
    return found;
}

describe('getAccessibilityTree', () => {
    let browser: Browser;

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
    }, 60000);

    afterAll(async () => {
        await browser?.close();
    });

    it('returns a tree with links carrying role and accessible name', async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
            await page.goto(FIXTURE, { waitUntil: 'domcontentloaded' });
            const tree = await getAccessibilityTree(page);

            expect(tree).not.toBeNull();

            const links = collect(tree, n => n.role === 'link');
            // The fixture has twelve tabbable links plus one with tabindex="-1",
            // which is still a link in the tree.
            expect(links.length).toBeGreaterThanOrEqual(12);
            expect(links.every(l => typeof l.name === 'string' && l.name.length > 0)).toBe(true);
            expect(links.map(l => l.name)).toContain('Alpha');
        } finally {
            await context.close();
        }
    }, 60000);

    it('preserves heading level, which callers depend on', async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
            await page.setContent(`
                <h1>Top</h1><h2>Second</h2><h3>Third</h3>
                <div role="heading" aria-level="4">Fourth</div>
            `);
            const tree = await getAccessibilityTree(page);
            const headings = collect(tree, n => n.role === 'heading');

            expect(headings.map(h => h.level)).toEqual([1, 2, 3, 4]);
            expect(headings.map(h => h.name)).toEqual(['Top', 'Second', 'Third', 'Fourth']);
        } finally {
            await context.close();
        }
    }, 60000);

    it('hoists children of generic wrappers instead of dropping them', async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
            // Nested meaningless divs must not hide the button beneath them.
            await page.setContent('<div><div><div><button>Deep</button></div></div></div>');
            const tree = await getAccessibilityTree(page);
            const buttons = collect(tree, n => n.role === 'button');

            expect(buttons).toHaveLength(1);
            expect(buttons[0].name).toBe('Deep');
        } finally {
            await context.close();
        }
    }, 60000);

    it('does not throw on a page with no content', async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
            await page.setContent('');
            await expect(getAccessibilityTree(page)).resolves.not.toThrow();
        } finally {
            await context.close();
        }
    }, 60000);
});
