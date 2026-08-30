/**
 * Regression tests for the non-unique-selector bug.
 *
 * Element identity used to be a display selector built from `tag#id.class`.
 * That string is not unique: links with no id and no class all render as "a",
 * and links sharing one class all render as "a.nav-link". Three such siblings
 * in a row looked like the same element focused three times, which
 *   - terminated the tab walk after three stops,
 *   - collapsed the reachable-element count to the number of distinct selectors,
 *   - and raised a critical WCAG 2.1.2 focus trap that did not exist.
 *
 * Both keyboard implementations are covered, because both had the defect and
 * both are reachable from the shipped CLI.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { auditKeyboard } from '../../packages/core/src/audits/keyboard.js';
import { checkKeyboardNavigation } from '../../packages/core/src/scanner/wcag22/keyboard-nav-check.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = `file://${join(__dirname, '../fixtures/keyboard-classless-links.html')}`;

/** Twelve links are tabbable. The three decoys in the footer are not. */
const EXPECTED_TABBABLE = 12;

describe('keyboard identity regression', () => {
    let browser: Browser;

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
    }, 60000);

    afterAll(async () => {
        await browser?.close();
    });

    const withPage = async (fn: (page: Page) => Promise<void>) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
            await page.goto(FIXTURE, { waitUntil: 'domcontentloaded' });
            await fn(page);
        } finally {
            await context.close();
        }
    };

    describe('auditKeyboard', () => {
        it('reaches every tabbable element despite duplicate selectors', async () => {
            await withPage(async (page) => {
                const result = await auditKeyboard(FIXTURE, { page });

                // The headline regression: this returned 3 before the fix.
                expect(result.uniqueTabStops).toBe(EXPECTED_TABBABLE);
                expect(result.terminationReason).toBe('cycled');
            });
        }, 60000);

        it('excludes tabindex="-1", disabled, and hidden elements from the denominator', async () => {
            await withPage(async (page) => {
                const result = await auditKeyboard(FIXTURE, { page });

                expect(result.tabbableCount).toBe(EXPECTED_TABBABLE);
                // Every tabbable element was reached, so the ratio is exactly 1.
                expect(result.uniqueTabStops / result.tabbableCount).toBe(1);
            });
        }, 60000);

        it('does not fabricate a focus trap from siblings sharing a class', async () => {
            await withPage(async (page) => {
                const result = await auditKeyboard(FIXTURE, { page });

                expect(result.focusTrapDetected).toBe(false);
                expect(result.issues.filter(i => i.wcag === '2.1.2')).toHaveLength(0);
            });
        }, 60000);

        it('marks a truncated walk as capped rather than reporting it as unreachable', async () => {
            await withPage(async (page) => {
                const result = await auditKeyboard(FIXTURE, { page, maxTabs: 3 });

                expect(result.terminationReason).toBe('capped');

                // A capped walk proves nothing about reachability, so it must not
                // assert that elements are unreachable...
                const unreachabilityClaims = result.issues.filter(
                    i => i.wcag === '2.1.1' && i.severity === 'serious'
                );
                expect(unreachabilityClaims).toHaveLength(0);

                // ...but it must say so, rather than staying silent and letting the
                // caller mistake an unmeasured page for a clean one.
                const notice = result.issues.find(i => i.wcag === '2.1.1');
                expect(notice?.severity).toBe('moderate');
                expect(notice?.message).toMatch(/could not be measured/i);
            });
        }, 60000);
    });

    describe('checkKeyboardNavigation (scan path)', () => {
        it('raises neither a false 2.1.1 shortfall nor a false 2.1.2 trap', async () => {
            await withPage(async (page) => {
                const results = await checkKeyboardNavigation(page);
                const byId = (id: string) => results.find(r => r.criterionId === id);

                // Before the fix this reported "Only 2 of N reachable" plus a
                // critical focus trap on the shared-class group.
                expect(byId('2.1.1')?.status).toBe('pass');
                expect(byId('2.1.2')?.status).toBe('pass');
            });
        }, 60000);
    });
});
