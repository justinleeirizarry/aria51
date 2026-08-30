/**
 * Keyboard Audit
 *
 * Pure function that tests keyboard navigation on a page using Playwright.
 * No session state, no agent dependency — just URL in, results out.
 */
import { chromium } from 'playwright';
import type { KeyboardAuditResult, KeyboardAuditOptions, TabOrderEntry, AuditIssue, TabTermination } from './types.js';

/**
 * Elements that can hold focus. Membership here is necessary but not
 * sufficient — isTabbable() below applies the exclusions.
 */
const FOCUSABLE_SELECTOR = [
    'a[href]', 'area[href]', 'button', 'input', 'select', 'textarea',
    'summary', 'iframe', 'object', 'embed',
    'audio[controls]', 'video[controls]',
    '[contenteditable]', '[tabindex]',
].join(', ');

export async function auditKeyboard(
    url: string,
    options: KeyboardAuditOptions = {}
): Promise<KeyboardAuditResult> {
    const {
        maxTabs = 250,
        tabDelayMs = 50,
        headless = true,
        page: externalPage,
    } = options;
    const browser = externalPage ? null : await chromium.launch({ headless });

    try {
        const page = externalPage || await browser!.newPage({ bypassCSP: true });
        if (!externalPage) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const tabOrder: TabOrderEntry[] = [];
        const issues: AuditIssue[] = [];

        await page.evaluate(() => document.body.focus());

        let previousSelector = '';
        let sameCount = 0;
        let trapped = false;
        let nullStreak = 0;
        // Assume we exhausted the budget; the loop overwrites this if it breaks early.
        let terminationReason: TabTermination = 'capped';

        for (let i = 0; i < maxTabs; i++) {
            await page.keyboard.press('Tab');
            await new Promise(resolve => setTimeout(resolve, tabDelayMs));

            const info = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el || el === document.body) return null;

                const styles = window.getComputedStyle(el);
                const outline = styles.outline;
                const boxShadow = styles.boxShadow;
                const hasOutline = outline !== 'none' && outline !== '' && !outline.includes('0px');
                const hasBoxShadow = boxShadow !== 'none' && boxShadow !== '';
                const hasFocusStyle = hasOutline || hasBoxShadow;

                const tag = el.tagName.toLowerCase();
                const id = el.id ? `#${el.id}` : '';
                const cls = el.className && typeof el.className === 'string'
                    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
                    : '';
                const selector = `${tag}${id}${cls}`.slice(0, 80);

                // A structural path, unique per element. The display selector above
                // is NOT unique — on markup without ids or classes every link
                // serializes to the same string, which silently breaks both cycle
                // detection and any count derived from it.
                const path: number[] = [];
                let node: Element | null = el;
                while (node && node.parentElement) {
                    path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
                    node = node.parentElement;
                }
                const uid = path.join('-');

                return {
                    uid,
                    tag,
                    role: el.getAttribute('role') || el.tagName.toLowerCase(),
                    name: el.getAttribute('aria-label')
                        || el.getAttribute('aria-labelledby')
                        || (el as HTMLElement).innerText?.slice(0, 50)
                        || el.getAttribute('title')
                        || '',
                    selector,
                    hasFocusStyle,
                };
            });

            if (!info) {
                // Focus left the document (browser chrome). A short streak is the
                // normal end-of-page boundary; a sustained one means it never came back.
                nullStreak++;
                if (nullStreak >= 3 && tabOrder.length > 0) {
                    terminationReason = 'exhausted';
                    break;
                }
                continue;
            }
            nullStreak = 0;

            if (info.uid === previousSelector) {
                sameCount++;
                if (sameCount >= 3) {
                    issues.push({ severity: 'critical', wcag: '2.1.2', message: `Focus trap detected at ${info.selector} — focus cannot escape this element` });
                    trapped = true;
                    terminationReason = 'trapped';
                    break;
                }
            } else {
                sameCount = 0;
            }
            previousSelector = info.uid;

            tabOrder.push({ index: i + 1, ...info });

            if (tabOrder.length > 2 && info.uid === tabOrder[0].uid) {
                terminationReason = 'cycled';
                break;
            }
        }

        const noFocusIndicator = tabOrder.filter(e => !e.hasFocusStyle);
        if (noFocusIndicator.length > 0) {
            issues.push({
                severity: 'serious',
                wcag: '2.4.7',
                message: `${noFocusIndicator.length} element(s) lack visible focus indicators: ${noFocusIndicator.slice(0, 5).map(e => e.selector).join(', ')}`,
            });
        }

        const firstElement = tabOrder[0];
        const hasSkipLink = !!firstElement && (
            firstElement.name.toLowerCase().includes('skip') ||
            firstElement.name.toLowerCase().includes('main content')
        );
        if (!hasSkipLink) {
            issues.push({ severity: 'moderate', wcag: '2.4.1', message: 'No skip link found as first focusable element' });
        }

        const totalInteractive = await page.evaluate(() =>
            document.querySelectorAll('a[href], button, input, select, textarea, [tabindex], [role="button"], [role="link"]').length
        );

        // The honest denominator: elements the browser will actually stop on.
        // NOTE: the predicate is inlined rather than hoisted to a named function.
        // Bundlers that preserve function names inject a __name helper that is not
        // defined inside the page context, which throws at evaluate time.
        const tabbableCount = await page.evaluate((selector) => {
            return Array.from(document.querySelectorAll(selector)).filter((el) => {
                const ti = el.getAttribute('tabindex');
                // tabindex="-1" is focusable by script but deliberately skipped by Tab.
                if (ti !== null && Number.parseInt(ti, 10) < 0) return false;
                if ((el as HTMLInputElement).disabled) return false;
                if (el.closest('[inert]')) return false;
                // contenteditable="false" is not editable and not tabbable on its own.
                if (el.getAttribute('contenteditable') === 'false' && ti === null) return false;

                const cs = window.getComputedStyle(el);
                if (cs.display === 'none') return false;
                if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;

                // No layout box means unreachable — this also catches elements inside
                // a display:none ancestor and inside a closed <details>. Visually-hidden
                // skip links survive because clip/clip-path still produces a rect.
                if (el.getClientRects().length === 0 && cs.position !== 'fixed') return false;

                return true;
            }).length;
        }, FOCUSABLE_SELECTOR);

        // Only a complete pass can prove unreachability. A capped run tells us
        // nothing — tabStops is a floor, so the comparison would be meaningless.
        const uniqueReached = new Set(tabOrder.map(e => e.uid)).size;
        const measurementComplete = terminationReason === 'cycled' || terminationReason === 'exhausted';
        if (measurementComplete && tabbableCount > 0 && uniqueReached < tabbableCount * 0.5) {
            issues.push({
                severity: 'serious',
                wcag: '2.1.1',
                message: `Only ${uniqueReached} of ${tabbableCount} tabbable elements are reachable via Tab`,
            });
        } else if (terminationReason === 'capped') {
            issues.push({
                severity: 'moderate',
                wcag: '2.1.1',
                message: `Tab walk hit the ${maxTabs}-stop limit before completing — keyboard reachability could not be measured. Raise maxTabs to audit this page fully.`,
            });
        }

        return {
            url,
            timestamp: new Date().toISOString(),
            tabStops: tabOrder.length,
            uniqueTabStops: new Set(tabOrder.map(e => e.uid)).size,
            totalInteractive,
            tabbableCount,
            terminationReason,
            focusTrapDetected: trapped,
            hasSkipLink,
            elementsWithoutFocusIndicator: noFocusIndicator.length,
            tabOrder,
            issues,
        };
    } finally {
        if (browser) await browser.close();
    }
}
