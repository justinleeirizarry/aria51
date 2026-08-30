/**
 * Lightweight Screen Reader Navigation Checks
 *
 * Pure Playwright checks ported from ai-auditor's screen-reader-navigator.ts.
 * All logic uses page.evaluate(), page.accessibility.snapshot(), and
 * page.keyboard.press() — no AI calls, no extra browser instances.
 *
 * Tested WCAG criteria: 1.1.1, 1.3.1, 2.4.1, 2.4.2, 2.4.4, 2.4.6, 3.3.2, 4.1.2
 */
import type { Page } from 'playwright';
import type { SupplementalTestResult, SupplementalIssue } from '../../types.js';
import { logger } from '../../utils/logger.js';
import { getAccessibilityTree } from '../../utils/accessibility-tree.js';

/** Snapshot node as returned by Playwright */
interface SnapshotNode {
    role: string;
    name: string;
    children?: SnapshotNode[];
    level?: number;
}

interface LandmarkEntry {
    role: string;
    name?: string;
    childCount: number;
}

/**
 * Run all screen reader navigation checks on the current page.
 * Returns one SupplementalTestResult per WCAG criterion.
 */
export async function checkScreenReaderNavigation(page: Page): Promise<SupplementalTestResult[]> {
    const issues = new Map<string, SupplementalIssue[]>();

    // Initialize buckets for each criterion we test
    const criteria = ['1.1.1', '1.3.1', '2.4.1', '2.4.2', '2.4.4', '2.4.6', '3.3.2', '4.1.2'];
    for (const id of criteria) {
        issues.set(id, []);
    }

    try {
        // 1. Page title check (2.4.2)
        const pageTitle = await page.title();
        if (!pageTitle || pageTitle.trim() === '') {
            issues.get('2.4.2')!.push({
                message: 'Page has no title element',
                severity: 'serious',
            });
        }

        // 2. Landmark check (1.3.1, 2.4.1)
        const landmarks = await extractLandmarks(page);
        analyzeLandmarks(landmarks, issues);

        // 3. Heading check (1.3.1, 2.4.6)
        // page.accessibility was removed in Playwright 1.62; read it over CDP.
        const snapshot = await getAccessibilityTree(page);
        if (snapshot) {
            const headings = extractHeadings(snapshot as SnapshotNode);
            analyzeHeadings(headings, issues);
        }

        // 4. Interactive element names (4.1.2, 2.4.4)
        if (snapshot) {
            checkInteractiveNames(snapshot as SnapshotNode, issues);
        }

        // 5. Images without alt (1.1.1)
        await checkImages(page, issues);

        // 6. Form labels (3.3.2)
        await checkFormLabels(page, issues);

        // 7. Skip link (2.4.1)
        await checkSkipLink(page, issues);
    } catch (err) {
        logger.warn(`Screen reader check encountered an error: ${err}`);
    }

    // Build results
    const results: SupplementalTestResult[] = [];
    for (const [criterionId, criterionIssues] of issues) {
        results.push({
            criterionId,
            status: criterionIssues.length > 0 ? 'fail' : 'pass',
            source: 'playwright-screen-reader',
            issues: criterionIssues,
        });
    }

    return results;
}

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

async function extractLandmarks(page: Page): Promise<LandmarkEntry[]> {
    return page.evaluate(() => {
        const landmarks: Array<{ role: string; name?: string; childCount: number }> = [];
        const semanticMap: Record<string, string> = {
            HEADER: 'banner',
            NAV: 'navigation',
            MAIN: 'main',
            ASIDE: 'complementary',
            FOOTER: 'contentinfo',
        };

        // Explicit role attributes
        const roleEls = document.querySelectorAll('[role]');
        for (const el of roleEls) {
            const role = el.getAttribute('role')!;
            if (['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form', 'region'].includes(role)) {
                landmarks.push({
                    role,
                    name: el.getAttribute('aria-label') ||
                        (el.getAttribute('aria-labelledby')
                            ? document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent?.trim()
                            : undefined) ||
                        undefined,
                    childCount: el.children.length,
                });
            }
        }

        // Semantic HTML elements without explicit roles
        for (const [tag, role] of Object.entries(semanticMap)) {
            const elements = document.querySelectorAll(tag.toLowerCase());
            for (const el of elements) {
                if (!el.hasAttribute('role')) {
                    landmarks.push({
                        role,
                        name: el.getAttribute('aria-label') || undefined,
                        childCount: el.children.length,
                    });
                }
            }
        }

        // Deduplicate
        const seen = new Set<string>();
        return landmarks.filter(l => {
            const key = `${l.role}:${l.name || ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    });
}

function analyzeLandmarks(landmarks: LandmarkEntry[], issues: Map<string, SupplementalIssue[]>): void {
    const mainLandmarks = landmarks.filter(l => l.role === 'main');

    if (mainLandmarks.length === 0) {
        const issue: SupplementalIssue = {
            message: 'Page has no main landmark. Screen reader users cannot jump to main content.',
            severity: 'critical',
        };
        issues.get('1.3.1')!.push(issue);
        issues.get('2.4.1')!.push(issue);
    } else if (mainLandmarks.length > 1) {
        issues.get('1.3.1')!.push({
            message: `Page has ${mainLandmarks.length} main landmarks. There should be exactly one.`,
            severity: 'moderate',
        });
    }

    if (landmarks.length === 0) {
        const issue: SupplementalIssue = {
            message: 'Page has no ARIA landmarks. Screen reader users cannot navigate by landmarks.',
            severity: 'critical',
        };
        issues.get('1.3.1')!.push(issue);
        issues.get('2.4.1')!.push(issue);
    }

    // Check duplicate roles without labels
    const roleCounts = new Map<string, LandmarkEntry[]>();
    for (const landmark of landmarks) {
        const existing = roleCounts.get(landmark.role) || [];
        existing.push(landmark);
        roleCounts.set(landmark.role, existing);
    }
    for (const [role, entries] of roleCounts) {
        if (entries.length > 1) {
            const unlabeled = entries.filter(e => !e.name);
            if (unlabeled.length > 0) {
                issues.get('1.3.1')!.push({
                    message: `Multiple "${role}" landmarks exist but ${unlabeled.length} lack an accessible label.`,
                    severity: 'serious',
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

function extractHeadings(node: SnapshotNode): Array<{ level: number; text: string }> {
    const headings: Array<{ level: number; text: string }> = [];

    if (node.role === 'heading' && node.level) {
        headings.push({ level: node.level, text: node.name || '' });
    }
    if (node.children) {
        for (const child of node.children) {
            headings.push(...extractHeadings(child));
        }
    }
    return headings;
}

function analyzeHeadings(headings: Array<{ level: number; text: string }>, issues: Map<string, SupplementalIssue[]>): void {
    if (headings.length === 0) {
        issues.get('1.3.1')!.push({
            message: 'Page has no headings. Screen reader users cannot navigate by heading.',
            severity: 'serious',
        });
        return;
    }

    const h1s = headings.filter(h => h.level === 1);
    if (h1s.length === 0) {
        issues.get('2.4.6')!.push({
            message: 'Page has no h1 heading. Screen readers expect a primary heading.',
            severity: 'serious',
        });
    } else if (h1s.length > 1) {
        issues.get('2.4.6')!.push({
            message: `Page has ${h1s.length} h1 headings. Best practice is to have exactly one.`,
            severity: 'moderate',
        });
    }

    // Empty headings
    for (const heading of headings) {
        if (!heading.text || heading.text.trim() === '') {
            issues.get('2.4.6')!.push({
                message: `Empty h${heading.level} heading found. Screen readers will announce an empty heading.`,
                severity: 'moderate',
            });
        }
    }

    // Level skips
    let previousLevel = 0;
    for (const heading of headings) {
        if (previousLevel > 0 && heading.level > previousLevel + 1) {
            issues.get('1.3.1')!.push({
                message: `Heading level skipped: h${previousLevel} → h${heading.level}. Screen readers use heading hierarchy for navigation.`,
                severity: 'moderate',
            });
        }
        previousLevel = heading.level;
    }
}

// ---------------------------------------------------------------------------
// Interactive element names
// ---------------------------------------------------------------------------

function checkInteractiveNames(node: SnapshotNode, issues: Map<string, SupplementalIssue[]>): void {
    // Buttons/links without names
    if ((node.role === 'button' || node.role === 'link') && (!node.name || node.name.trim() === '')) {
        issues.get('4.1.2')!.push({
            message: `${node.role} has no accessible name. Screen readers cannot describe its purpose.`,
            severity: 'critical',
        });
    }

    // Generic link text
    if (node.role === 'link' && node.name) {
        const genericTexts = ['click here', 'here', 'read more', 'more', 'learn more', 'link', 'details'];
        if (genericTexts.includes(node.name.toLowerCase().trim())) {
            issues.get('2.4.4')!.push({
                message: `Link text "${node.name}" is not descriptive. Screen reader users navigating by links lose context.`,
                severity: 'serious',
            });
        }
    }

    if (node.children) {
        for (const child of node.children) {
            checkInteractiveNames(child, issues);
        }
    }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

async function checkImages(page: Page, issues: Map<string, SupplementalIssue[]>): Promise<void> {
    const missingAlt = await page.evaluate(() => {
        const results: Array<{ src: string }> = [];
        const images = document.querySelectorAll('img');
        for (const img of images) {
            if (!img.hasAttribute('alt')) {
                results.push({ src: img.src?.slice(0, 80) || '' });
            }
        }
        return results;
    });

    for (const img of missingAlt) {
        issues.get('1.1.1')!.push({
            message: `Image has no alt attribute (src: ${img.src}). Screen readers cannot describe this image.`,
            severity: 'critical',
            evidence: img.src,
        });
    }
}

// ---------------------------------------------------------------------------
// Form labels
// ---------------------------------------------------------------------------

async function checkFormLabels(page: Page, issues: Map<string, SupplementalIssue[]>): Promise<void> {
    const unlabeled = await page.evaluate(() => {
        const results: Array<{ type: string; selector: string }> = [];
        const inputs = document.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), select, textarea'
        );
        for (const input of inputs) {
            const id = input.getAttribute('id');
            const hasLabel = id ? !!document.querySelector(`label[for="${id}"]`) : false;
            const hasAriaLabel = !!input.getAttribute('aria-label');
            const hasAriaLabelledBy = !!input.getAttribute('aria-labelledby');
            const hasTitle = !!input.getAttribute('title');
            const parentLabel = !!input.closest('label');

            if (!hasLabel && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !parentLabel) {
                // Build a simple selector for evidence
                const tag = input.tagName.toLowerCase();
                const type = input.getAttribute('type') || 'text';
                const name = input.getAttribute('name') || '';
                results.push({
                    type: tag === 'input' ? type : tag,
                    selector: name ? `${tag}[name="${name}"]` : tag,
                });
            }
        }
        return results;
    });

    for (const input of unlabeled) {
        issues.get('3.3.2')!.push({
            message: `Form input (${input.type}) has no label. Screen readers cannot describe this input.`,
            selector: input.selector,
            severity: 'critical',
        });
    }
}

// ---------------------------------------------------------------------------
// Skip link
// ---------------------------------------------------------------------------

async function checkSkipLink(page: Page, issues: Map<string, SupplementalIssue[]>): Promise<void> {
    // Reset focus to body
    await page.evaluate(() => (document.body as HTMLElement).focus());
    await page.keyboard.press('Tab');
    // Brief wait for focus to settle
    await new Promise(resolve => setTimeout(resolve, 200));

    const firstFocused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return {
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim() || '',
            href: el.getAttribute('href') || '',
        };
    });

    if (!firstFocused) {
        issues.get('2.4.1')!.push({
            message: 'No skip link found. Screen reader users must tab through all navigation to reach main content.',
            severity: 'serious',
        });
        return;
    }

    const isSkipLink = firstFocused.tag === 'a' &&
        (firstFocused.text.toLowerCase().includes('skip') ||
         firstFocused.text.toLowerCase().includes('main content'));

    if (!isSkipLink) {
        issues.get('2.4.1')!.push({
            message: `First focusable element is not a skip link (found: ${firstFocused.tag} "${firstFocused.text.slice(0, 50)}").`,
            severity: 'serious',
        });
        return;
    }

    // Verify skip link target exists
    if (firstFocused.href && firstFocused.href.startsWith('#')) {
        const targetId = firstFocused.href.slice(1);
        const targetExists = await page.evaluate((id: string) => !!document.getElementById(id), targetId);

        if (!targetExists) {
            issues.get('2.4.1')!.push({
                message: `Skip link target "#${targetId}" does not exist. The skip link will not function.`,
                severity: 'serious',
            });
        }
    }

    // Restore focus
    await page.evaluate(() => (document.body as HTMLElement).focus());
}
