/**
 * Lightweight Keyboard Navigation Checks
 *
 * Pure Playwright checks ported from ai-auditor's keyboard-tester.ts.
 * Replaces Stagehand extract() calls with page.evaluate() + computed styles
 * for focus indicator detection.
 *
 * Known limitation: CSS-based heuristic cannot detect background-color changes
 * or custom pseudo-element indicators. Stagehand AI vision handles those when enabled.
 *
 * Tested WCAG criteria: 2.1.1, 2.1.2, 2.4.3, 2.4.7
 */
import type { Page } from 'playwright';
import type { SupplementalTestResult, SupplementalIssue } from '../../types.js';
import { logger } from '../../utils/logger.js';

const MAX_TABS = 250;
/** Settle time after each Tab press. 250 * 50ms caps a full walk at ~12s. */
const TAB_DELAY_MS = 50;

/**
 * Elements that can hold focus. Membership is necessary but not sufficient —
 * the predicate in countTabbable() applies the exclusions.
 */
const FOCUSABLE_SELECTOR = [
    'a[href]', 'area[href]', 'button', 'input', 'select', 'textarea',
    'summary', 'iframe', 'object', 'embed',
    'audio[controls]', 'video[controls]',
    '[contenteditable]', '[tabindex]',
].join(', ');

/**
 * Why the tab walk stopped. 'capped' means the element count is a floor rather
 * than a measurement, so no reachability claim may be derived from it.
 */
type TabTermination = 'cycled' | 'trapped' | 'exhausted' | 'capped';

interface FocusedElementInfo {
    /**
     * Structural path, unique per element. `selector` is for display only and is
     * NOT unique — on markup without ids or classes it collapses to the bare
     * tag, which silently breaks trap detection, cycle detection, and any count
     * derived from either.
     */
    uid: string;
    tag: string;
    role: string;
    name: string;
    selector: string;
    hasIndicator: boolean;
    landmark: string | null;
    isDialog: boolean;
}

/**
 * Run all keyboard navigation checks on the current page.
 * Returns one SupplementalTestResult per WCAG criterion.
 */
export async function checkKeyboardNavigation(page: Page): Promise<SupplementalTestResult[]> {
    const issues = new Map<string, SupplementalIssue[]>();

    // Initialize buckets for each criterion we test
    const criteria = ['2.1.1', '2.1.2', '2.4.3', '2.4.7'];
    for (const id of criteria) {
        issues.set(id, []);
    }

    try {
        // The honest denominator: elements the browser will actually stop on.
        // The predicate is inlined rather than hoisted to a named function —
        // bundlers that preserve function names inject a __name helper that is
        // undefined inside the page context and throws at evaluate time.
        const totalInteractive = await page.evaluate((selector) => {
            return Array.from(document.querySelectorAll(selector)).filter((el) => {
                const ti = el.getAttribute('tabindex');
                // tabindex="-1" is focusable by script but deliberately skipped by Tab.
                if (ti !== null && Number.parseInt(ti, 10) < 0) return false;
                if ((el as HTMLInputElement).disabled) return false;
                if (el.closest('[inert]')) return false;
                if (el.getAttribute('contenteditable') === 'false' && ti === null) return false;

                const cs = window.getComputedStyle(el);
                if (cs.display === 'none') return false;
                if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;

                // No layout box means unreachable. Also catches elements inside a
                // display:none ancestor or a closed <details>. Visually-hidden skip
                // links survive because clip/clip-path still produces a rect.
                if (el.getClientRects().length === 0 && cs.position !== 'fixed') return false;

                return true;
            }).length;
        }, FOCUSABLE_SELECTOR);

        // Reset focus
        await page.evaluate(() => (document.body as HTMLElement).focus());

        const focusedElements: FocusedElementInfo[] = [];
        let previousUid = '';
        let sameElementCount = 0;
        let nullStreak = 0;
        let focusTrapDetected = false;
        let focusTrapSelector = '';
        // Assume the budget was exhausted; the loop overwrites this if it breaks early.
        let terminationReason: TabTermination = 'capped';

        // Tab loop
        for (let i = 0; i < MAX_TABS; i++) {
            await page.keyboard.press('Tab');
            // Brief wait for focus + CSS transitions to settle
            await new Promise(resolve => setTimeout(resolve, TAB_DELAY_MS));

            const focused = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el || el === document.body) return null;

                // Display selector — human-readable, deliberately NOT used for
                // identity. Inlined rather than a named inner function so that
                // bundlers preserving function names cannot inject a __name
                // helper that is undefined in the page context.
                let selector: string;
                if (el.id) {
                    selector = `#${el.id}`;
                } else {
                    const t = el.tagName.toLowerCase();
                    const nameAttr = el.getAttribute('name');
                    if (nameAttr) {
                        selector = `${t}[name="${nameAttr}"]`;
                    } else {
                        const classes = el.className && typeof el.className === 'string'
                            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
                            : '';
                        selector = `${t}${classes}`;
                    }
                }

                // Identity: index path from the root. Unique per element.
                const path: number[] = [];
                let walker: Element | null = el;
                while (walker && walker.parentElement) {
                    path.unshift(Array.prototype.indexOf.call(walker.parentElement.children, walker));
                    walker = walker.parentElement;
                }
                const uid = path.join('-');

                // Check focus indicator via computed styles
                const style = window.getComputedStyle(el);
                const hasIndicator =
                    (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') ||
                    (style.boxShadow !== 'none' && style.boxShadow !== '');

                // Determine parent landmark
                let landmark: string | null = null;
                let current: Element | null = el;
                const semanticMap: Record<string, string> = {
                    HEADER: 'banner', NAV: 'navigation', MAIN: 'main',
                    ASIDE: 'complementary', FOOTER: 'contentinfo',
                };
                while (current) {
                    const role = current.getAttribute('role');
                    if (role && ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form', 'region'].includes(role)) {
                        landmark = role;
                        break;
                    }
                    if (semanticMap[current.tagName]) {
                        landmark = semanticMap[current.tagName];
                        break;
                    }
                    current = current.parentElement;
                }

                // Check if inside a dialog (legitimate focus trap)
                let isDialog = false;
                current = el;
                while (current) {
                    const role = current.getAttribute('role');
                    if (role === 'dialog' || role === 'alertdialog' || current.tagName === 'DIALOG') {
                        isDialog = true;
                        break;
                    }
                    current = current.parentElement;
                }

                return {
                    uid,
                    tag: el.tagName.toLowerCase(),
                    role: el.getAttribute('role') || el.tagName.toLowerCase(),
                    name: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 50) || '',
                    selector,
                    hasIndicator,
                    landmark,
                    isDialog,
                };
            });

            if (!focused) {
                // Focus left the document (browser chrome). A short streak is the
                // normal end-of-page boundary; a sustained one means it never returned.
                nullStreak++;
                if (nullStreak >= 3 && focusedElements.length > 0) {
                    terminationReason = 'exhausted';
                    break;
                }
                continue;
            }
            nullStreak = 0;

            // Detect focus traps: the SAME element 3+ times in a row, not in a dialog.
            // Compared by uid, never by selector — sibling links sharing a class
            // produce an identical selector and would fabricate a critical 2.1.2.
            if (focused.uid === previousUid) {
                sameElementCount++;
                if (sameElementCount >= 3 && !focused.isDialog) {
                    focusTrapDetected = true;
                    focusTrapSelector = focused.selector;
                    terminationReason = 'trapped';
                    break;
                }
            } else {
                sameElementCount = 0;
            }
            previousUid = focused.uid;

            focusedElements.push(focused);

            // Detect cycle back to start
            if (focusedElements.length > 2 && focused.uid === focusedElements[0].uid) {
                terminationReason = 'cycled';
                break;
            }
        }

        // --- Analyze results ---

        // 2.1.1 Keyboard Accessibility
        // If we found significantly fewer focusable elements than interactive elements, flag it
        // Counted by uid: deduplicating on `selector` collapses every class-less
        // link on a page into a single entry and manufactures a false shortfall.
        const uniqueFocused = new Set(focusedElements.map(e => e.uid)).size;

        // Only a complete walk can prove unreachability. After a cap, the count is
        // a floor, so any comparison against it is meaningless and must be skipped.
        const measurementComplete = terminationReason === 'cycled' || terminationReason === 'exhausted';
        if (measurementComplete && totalInteractive > 0 && uniqueFocused < totalInteractive * 0.5) {
            issues.get('2.1.1')!.push({
                message: `Only ${uniqueFocused} of ${totalInteractive} tabbable elements are reachable via keyboard Tab.`,
                severity: 'serious',
                evidence: `${Math.round((uniqueFocused / totalInteractive) * 100)}% keyboard accessible`,
            });
        } else if (terminationReason === 'capped') {
            logger.warn(
                `Tab walk hit the ${MAX_TABS}-stop limit on this page — keyboard reachability was not measured and no 2.1.1 claim was made.`
            );
        }

        // 2.1.2 No Keyboard Trap
        if (focusTrapDetected) {
            issues.get('2.1.2')!.push({
                message: `Focus trap detected at ${focusTrapSelector}. Users cannot Tab away from this element.`,
                selector: focusTrapSelector,
                severity: 'critical',
            });
        }

        // 2.4.3 Focus Order — elements outside any landmark
        const outsideLandmarks = focusedElements.filter(el => !el.landmark && !el.isDialog);
        if (outsideLandmarks.length > 0) {
            issues.get('2.4.3')!.push({
                message: `${outsideLandmarks.length} focusable element(s) are outside any landmark region.`,
                severity: 'moderate',
                evidence: outsideLandmarks.slice(0, 5).map(e => e.selector).join(', '),
            });
        }

        // 2.4.7 Focus Visible — elements without visible focus indicator
        const noIndicator = focusedElements.filter(el => !el.hasIndicator);
        if (noIndicator.length > 0) {
            // Report up to 10 elements without focus indicators
            for (const el of noIndicator.slice(0, 10)) {
                issues.get('2.4.7')!.push({
                    message: `${el.role} "${el.name.slice(0, 40)}" has no visible focus indicator (outline or box-shadow).`,
                    selector: el.selector,
                    severity: 'serious',
                });
            }
        }
    } catch (err) {
        logger.warn(`Keyboard navigation check encountered an error: ${err}`);
    }

    // Restore focus
    try {
        await page.evaluate(() => (document.body as HTMLElement).focus());
    } catch {
        // Non-critical
    }

    // Build results
    const results: SupplementalTestResult[] = [];
    for (const [criterionId, criterionIssues] of issues) {
        results.push({
            criterionId,
            status: criterionIssues.length > 0 ? 'fail' : 'pass',
            source: 'playwright-keyboard',
            issues: criterionIssues,
        });
    }

    return results;
}
