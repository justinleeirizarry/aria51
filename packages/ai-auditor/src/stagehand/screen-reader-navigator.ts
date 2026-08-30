/**
 * Screen Reader Navigator
 *
 * Simulates screen reader navigation patterns using Playwright's accessibility
 * snapshot for headings/interactive elements and DOM queries for landmarks.
 * Tests keyboard navigation between landmarks and validates a11y tree structure.
 *
 * This tests the same underlying data real screen readers consume
 * without requiring an actual screen reader extension.
 */
import { Stagehand } from "@browserbasehq/stagehand";
import type { Page } from "playwright";
import type {
    ScreenReaderNavigatorConfig,
    ScreenReaderNavigationResults,
    LandmarkEntry,
    HeadingEntry,
    NavigationStep,
    ScreenReaderIssue,
    ScreenReaderIssueType,
    WcagCriterionInfo,
} from "../types.js";
import { logger, getCriterionById, getAccessibilityTree } from "@aria51/core";

/** WCAG criteria relevant to screen reader navigation */
const SCREEN_READER_WCAG_MAP: Record<ScreenReaderIssueType, string[]> = {
    'missing-landmark': ['1.3.1', '2.4.1'],
    'missing-main-landmark': ['1.3.1', '2.4.1'],
    'multiple-main-landmarks': ['1.3.1'],
    'landmark-no-label': ['1.3.1', '2.4.6'],
    'heading-skip': ['1.3.1', '2.4.6'],
    'missing-h1': ['1.3.1', '2.4.6'],
    'multiple-h1': ['1.3.1', '2.4.6'],
    'empty-heading': ['1.3.1', '2.4.6'],
    'missing-skip-link': ['2.4.1'],
    'broken-skip-link': ['2.4.1'],
    'missing-page-title': ['2.4.2'],
    'generic-link-text': ['2.4.4'],
    'missing-alt-text': ['1.1.1'],
    'missing-form-label': ['1.3.1', '3.3.2'],
    'missing-element-name': ['4.1.2'],
    'tab-not-following-landmarks': ['2.4.3'],
};

function getWcagCriteria(issueType: ScreenReaderIssueType): WcagCriterionInfo[] {
    const ids = SCREEN_READER_WCAG_MAP[issueType] || [];
    return ids
        .map(id => getCriterionById(id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined)
        .map(c => ({
            id: c.id,
            title: c.title,
            level: c.level,
            principle: c.principle,
            w3cUrl: c.w3cUrl,
        }));
}

/** Snapshot node as returned by Playwright */
interface SnapshotNode {
    role: string;
    name: string;
    children?: SnapshotNode[];
    level?: number;
    checked?: boolean | 'mixed';
    disabled?: boolean;
    expanded?: boolean;
    focused?: boolean;
    pressed?: boolean | 'mixed';
    selected?: boolean;
    value?: string | number;
}

export class ScreenReaderNavigator {
    private stagehand: Stagehand | null = null;
    private config: ScreenReaderNavigatorConfig;

    constructor(config: ScreenReaderNavigatorConfig = {}) {
        this.config = {
            verbose: false,
            model: 'gpt-4o-mini',
            testKeyboardNav: true,
            maxTabPresses: 50,
            ...config,
        };
    }

    get page(): Page | null {
        if (!this.stagehand) return null;
        return (this.stagehand as any).page || null;
    }

    async init(): Promise<void> {
        logger.debug('Initializing Screen Reader Navigator...');

        const options: any = this.config.browserbaseSessionId
            ? {
                env: 'BROWSERBASE' as const,
                browserbaseSessionID: this.config.browserbaseSessionId,
                modelName: this.config.model || 'gpt-4o-mini',
                verbose: (this.config.verbose ? 2 : 0) as 0 | 2,
            }
            : {
                env: 'LOCAL' as const,
                modelName: this.config.model || 'gpt-4o-mini',
                verbose: (this.config.verbose ? 2 : 0) as 0 | 2,
                headless: true,
            };

        this.stagehand = new Stagehand(options);
        await this.stagehand.init();
        logger.debug('Screen Reader Navigator initialized');
    }

    async navigate(url: string): Promise<ScreenReaderNavigationResults> {
        if (!this.stagehand || !this.page) {
            throw new Error("Navigator not initialized");
        }

        logger.debug(`Screen reader navigation test for ${url}...`);

        await this.page.goto(url, { waitUntil: 'networkidle' });
        await new Promise(resolve => setTimeout(resolve, 1000));

        const issues: ScreenReaderIssue[] = [];
        const steps: NavigationStep[] = [];

        // 1. Check page title
        const pageTitle = await this.page.title();
        steps.push({ action: 'read-title', description: `Page title: "${pageTitle}"`, timestamp: Date.now() });
        if (!pageTitle || pageTitle.trim() === '') {
            issues.push({
                type: 'missing-page-title',
                message: 'Page has no title element',
                wcagCriteria: getWcagCriteria('missing-page-title'),
                severity: 'serious',
            });
        }

        // 2. Get accessibility snapshot (for headings and interactive elements)
        logger.debug('Taking accessibility snapshot...');
        const snapshot = await getAccessibilityTree(this.page);
        if (!snapshot) {
            throw new Error("Could not get accessibility snapshot");
        }

        // 3. Navigate by landmarks (via DOM queries, since snapshots flatten landmarks)
        logger.debug('Navigating by landmarks...');
        const landmarks = await this.extractLandmarksFromDOM();
        steps.push({ action: 'list-landmarks', description: `Found ${landmarks.length} landmarks`, timestamp: Date.now() });
        const landmarkIssues = this.analyzeLandmarks(landmarks);
        issues.push(...landmarkIssues);

        for (const landmark of landmarks) {
            steps.push({
                action: 'navigate-landmark',
                description: `→ ${landmark.role}${landmark.name ? `: "${landmark.name}"` : ''}`,
                element: { role: landmark.role, name: landmark.name },
                timestamp: Date.now(),
            });
        }

        // 4. Navigate by headings (from snapshot)
        logger.debug('Navigating by headings...');
        const headings = this.extractHeadings(snapshot as SnapshotNode);
        steps.push({ action: 'list-headings', description: `Found ${headings.length} headings`, timestamp: Date.now() });
        const headingIssues = this.analyzeHeadings(headings);
        issues.push(...headingIssues);

        for (const heading of headings) {
            steps.push({
                action: 'navigate-heading',
                description: `→ h${heading.level}: "${heading.text}"`,
                element: { role: 'heading', name: heading.text, level: heading.level },
                timestamp: Date.now(),
            });
        }

        // 5. Check interactive elements (via DOM for images/inputs, snapshot for buttons/links)
        logger.debug('Checking interactive elements...');
        const interactiveIssues = [
            ...this.checkInteractiveElements(snapshot as SnapshotNode),
            ...(await this.checkDOMElements()),
        ];
        issues.push(...interactiveIssues);

        // 6. Test skip link
        logger.debug('Testing skip link...');
        const skipLinkIssues = await this.testSkipLink();
        issues.push(...skipLinkIssues);

        // 7. Test keyboard navigation between landmarks
        if (this.config.testKeyboardNav) {
            logger.debug('Testing keyboard navigation...');
            const keyboardSteps = await this.testKeyboardNavigation();
            steps.push(...keyboardSteps.steps);
            issues.push(...keyboardSteps.issues);
        }

        // Build summary
        const summary = {
            totalLandmarks: landmarks.length,
            totalHeadings: headings.length,
            totalIssues: issues.length,
            issuesBySeverity: issues.reduce((acc, issue) => {
                acc[issue.severity] = (acc[issue.severity] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
            landmarkCoverage: this.assessLandmarkCoverage(landmarks),
            headingStructureValid: headingIssues.length === 0,
        };

        return {
            url,
            timestamp: new Date().toISOString(),
            pageTitle,
            landmarks,
            headings,
            navigationSteps: steps,
            issues,
            summary,
        };
    }

    /**
     * Extract landmark regions from the DOM directly.
     * Playwright's accessibility snapshot flattens landmarks, so we query the DOM.
     */
    private async extractLandmarksFromDOM(): Promise<LandmarkEntry[]> {
        return this.page!.evaluate(() => {
            const landmarks: Array<{ role: string; name?: string; childCount: number }> = [];

            // Map of semantic elements to landmark roles
            const semanticMap: Record<string, string> = {
                'HEADER': 'banner',
                'NAV': 'navigation',
                'MAIN': 'main',
                'ASIDE': 'complementary',
                'FOOTER': 'contentinfo',
            };

            // Find elements with explicit role attributes
            const roleElements = document.querySelectorAll('[role]');
            for (const el of roleElements) {
                const role = el.getAttribute('role')!;
                if (['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form', 'region'].includes(role)) {
                    landmarks.push({
                        role,
                        name: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
                            ? (el.getAttribute('aria-label') ||
                               document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent?.trim())
                            : undefined,
                        childCount: el.children.length,
                    });
                }
            }

            // Find semantic HTML elements that don't have explicit roles
            // (avoid double-counting elements that already have role attributes)
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

            // Sort by DOM order
            const allLandmarkElements = [
                ...document.querySelectorAll('[role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"], [role="search"], [role="form"], [role="region"], header:not([role]), nav:not([role]), main:not([role]), aside:not([role]), footer:not([role])')
            ];

            // Re-sort landmarks by their position in the DOM
            const domOrder = new Map<string, number>();
            allLandmarkElements.forEach((el, idx) => {
                const role = el.getAttribute('role') || semanticMap[el.tagName] || '';
                const name = el.getAttribute('aria-label') || '';
                domOrder.set(`${role}:${name}`, idx);
            });

            landmarks.sort((a, b) => {
                const keyA = `${a.role}:${a.name || ''}`;
                const keyB = `${b.role}:${b.name || ''}`;
                return (domOrder.get(keyA) ?? 0) - (domOrder.get(keyB) ?? 0);
            });

            // Deduplicate (in case an element has both semantic tag and role attr)
            const seen = new Set<string>();
            return landmarks.filter(l => {
                const key = `${l.role}:${l.name || ''}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        });
    }

    /**
     * Extract headings from the accessibility snapshot
     */
    private extractHeadings(node: SnapshotNode, headings: HeadingEntry[] = []): HeadingEntry[] {
        if (node.role === 'heading' && node.level) {
            headings.push({
                level: node.level,
                text: node.name || '',
            });
        }

        if (node.children) {
            for (const child of node.children) {
                this.extractHeadings(child, headings);
            }
        }

        return headings;
    }

    /**
     * Analyze landmarks for issues
     */
    private analyzeLandmarks(landmarks: LandmarkEntry[]): ScreenReaderIssue[] {
        const issues: ScreenReaderIssue[] = [];

        const mainLandmarks = landmarks.filter(l => l.role === 'main');
        if (mainLandmarks.length === 0) {
            issues.push({
                type: 'missing-main-landmark',
                message: 'Page has no main landmark. Screen reader users cannot jump to main content.',
                wcagCriteria: getWcagCriteria('missing-main-landmark'),
                severity: 'critical',
            });
        } else if (mainLandmarks.length > 1) {
            issues.push({
                type: 'multiple-main-landmarks',
                message: `Page has ${mainLandmarks.length} main landmarks. There should be exactly one.`,
                wcagCriteria: getWcagCriteria('multiple-main-landmarks'),
                severity: 'moderate',
            });
        }

        if (landmarks.length === 0) {
            issues.push({
                type: 'missing-landmark',
                message: 'Page has no ARIA landmarks. Screen reader users cannot navigate by landmarks.',
                wcagCriteria: getWcagCriteria('missing-landmark'),
                severity: 'critical',
            });
        }

        // Check for multiple landmarks of same type without labels
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
                    issues.push({
                        type: 'landmark-no-label',
                        element: { role },
                        message: `Multiple "${role}" landmarks exist but ${unlabeled.length} lack an accessible label. Screen readers cannot distinguish between them.`,
                        wcagCriteria: getWcagCriteria('landmark-no-label'),
                        severity: 'serious',
                    });
                }
            }
        }

        return issues;
    }

    /**
     * Analyze heading structure for issues
     */
    private analyzeHeadings(headings: HeadingEntry[]): ScreenReaderIssue[] {
        const issues: ScreenReaderIssue[] = [];

        if (headings.length === 0) {
            issues.push({
                type: 'heading-skip',
                message: 'Page has no headings. Screen reader users cannot navigate by heading.',
                wcagCriteria: getWcagCriteria('heading-skip'),
                severity: 'serious',
            });
            return issues;
        }

        const h1s = headings.filter(h => h.level === 1);
        if (h1s.length === 0) {
            issues.push({
                type: 'missing-h1',
                message: 'Page has no h1 heading. Screen readers expect a primary heading.',
                wcagCriteria: getWcagCriteria('missing-h1'),
                severity: 'serious',
            });
        } else if (h1s.length > 1) {
            issues.push({
                type: 'multiple-h1',
                message: `Page has ${h1s.length} h1 headings. Best practice is to have exactly one.`,
                wcagCriteria: getWcagCriteria('multiple-h1'),
                severity: 'moderate',
            });
        }

        for (const heading of headings) {
            if (!heading.text || heading.text.trim() === '') {
                issues.push({
                    type: 'empty-heading',
                    element: { role: 'heading', level: heading.level },
                    message: `Empty h${heading.level} heading found. Screen readers will announce an empty heading.`,
                    wcagCriteria: getWcagCriteria('empty-heading'),
                    severity: 'moderate',
                });
            }
        }

        let previousLevel = 0;
        for (const heading of headings) {
            if (previousLevel > 0 && heading.level > previousLevel + 1) {
                issues.push({
                    type: 'heading-skip',
                    element: { role: 'heading', name: heading.text, level: heading.level },
                    message: `Heading level skipped: h${previousLevel} → h${heading.level}. Screen readers use heading hierarchy for navigation.`,
                    wcagCriteria: getWcagCriteria('heading-skip'),
                    severity: 'moderate',
                });
            }
            previousLevel = heading.level;
        }

        return issues;
    }

    /**
     * Check interactive elements in the snapshot for name issues
     */
    private checkInteractiveElements(node: SnapshotNode, issues: ScreenReaderIssue[] = []): ScreenReaderIssue[] {
        // Buttons/links without names
        if ((node.role === 'button' || node.role === 'link') && (!node.name || node.name.trim() === '')) {
            issues.push({
                type: 'missing-element-name',
                element: { role: node.role },
                message: `${node.role} has no accessible name. Screen readers cannot describe its purpose.`,
                wcagCriteria: getWcagCriteria('missing-element-name'),
                severity: 'critical',
            });
        }

        // Generic link text
        if (node.role === 'link' && node.name) {
            const genericTexts = ['click here', 'here', 'read more', 'more', 'learn more', 'link', 'details'];
            if (genericTexts.includes(node.name.toLowerCase().trim())) {
                issues.push({
                    type: 'generic-link-text',
                    element: { role: 'link', name: node.name },
                    message: `Link text "${node.name}" is not descriptive. Screen reader users navigating by links lose context.`,
                    wcagCriteria: getWcagCriteria('generic-link-text'),
                    severity: 'serious',
                });
            }
        }

        if (node.children) {
            for (const child of node.children) {
                this.checkInteractiveElements(child, issues);
            }
        }

        return issues;
    }

    /**
     * Check DOM directly for elements that Playwright's snapshot may omit
     * (images without alt, unlabeled inputs, etc.)
     */
    private async checkDOMElements(): Promise<ScreenReaderIssue[]> {
        return this.page!.evaluate(() => {
            const issues: Array<{
                type: string;
                element?: { role: string; name?: string };
                message: string;
                severity: string;
            }> = [];

            // Images without alt text
            const images = document.querySelectorAll('img');
            for (const img of images) {
                if (!img.hasAttribute('alt')) {
                    issues.push({
                        type: 'missing-alt-text',
                        element: { role: 'img' },
                        message: `Image has no alt text (src: ${img.src?.slice(0, 60)}...). Screen readers cannot describe this image.`,
                        severity: 'critical',
                    });
                }
            }

            // Form inputs without labels
            const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])');
            for (const input of inputs) {
                const id = input.getAttribute('id');
                const hasLabel = id && document.querySelector(`label[for="${id}"]`);
                const hasAriaLabel = input.getAttribute('aria-label');
                const hasAriaLabelledBy = input.getAttribute('aria-labelledby');
                const hasTitle = input.getAttribute('title');
                const parentLabel = input.closest('label');

                if (!hasLabel && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !parentLabel) {
                    issues.push({
                        type: 'missing-form-label',
                        element: { role: 'textbox' },
                        message: `Form input (type="${input.getAttribute('type') || 'text'}") has no label. Screen readers cannot describe this input.`,
                        severity: 'critical',
                    });
                }
            }

            return issues;
        }).then(rawIssues =>
            rawIssues.map(i => ({
                type: i.type as ScreenReaderIssueType,
                element: i.element as ScreenReaderIssue['element'],
                message: i.message,
                wcagCriteria: [], // Will be populated in the caller if needed
                severity: i.severity as ScreenReaderIssue['severity'],
            }))
        ).then(issues =>
            // Attach WCAG criteria
            issues.map(i => ({
                ...i,
                wcagCriteria: getWcagCriteria(i.type),
            }))
        );
    }

    /**
     * Test skip link functionality via keyboard
     */
    private async testSkipLink(): Promise<ScreenReaderIssue[]> {
        const issues: ScreenReaderIssue[] = [];
        const page = this.page!;

        await page.evaluate(() => document.body.focus());
        await page.keyboard.press('Tab');
        await new Promise(resolve => setTimeout(resolve, 200));

        const firstFocused = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el) return null;
            return {
                tag: el.tagName.toLowerCase(),
                text: el.textContent?.trim() || '',
                href: el.getAttribute('href') || '',
            };
        });

        if (!firstFocused) {
            issues.push({
                type: 'missing-skip-link',
                message: 'No skip link found. Screen reader users must tab through all navigation to reach main content.',
                wcagCriteria: getWcagCriteria('missing-skip-link'),
                severity: 'serious',
            });
            return issues;
        }

        const isSkipLink = firstFocused.tag === 'a' &&
            (firstFocused.text.toLowerCase().includes('skip') ||
             firstFocused.text.toLowerCase().includes('main content'));

        if (!isSkipLink) {
            issues.push({
                type: 'missing-skip-link',
                message: `First focusable element is not a skip link (found: ${firstFocused.tag} "${firstFocused.text}"). Screen reader users must tab through navigation to reach content.`,
                wcagCriteria: getWcagCriteria('missing-skip-link'),
                severity: 'serious',
            });
            return issues;
        }

        if (firstFocused.href && firstFocused.href.startsWith('#')) {
            const targetId = firstFocused.href.slice(1);
            const targetExists = await page.evaluate((id: string) => {
                return document.getElementById(id) !== null;
            }, targetId);

            if (!targetExists) {
                issues.push({
                    type: 'broken-skip-link',
                    message: `Skip link target "#${targetId}" does not exist. The skip link will not function.`,
                    wcagCriteria: getWcagCriteria('broken-skip-link'),
                    severity: 'serious',
                });
            }
        }

        return issues;
    }

    /**
     * Test keyboard navigation between focusable elements
     */
    private async testKeyboardNavigation(): Promise<{
        steps: NavigationStep[];
        issues: ScreenReaderIssue[];
    }> {
        const steps: NavigationStep[] = [];
        const issues: ScreenReaderIssue[] = [];
        const page = this.page!;
        const maxTabs = this.config.maxTabPresses || 50;

        await page.evaluate(() => document.body.focus());

        const focusedElements: Array<{
            tag: string;
            role: string;
            name: string;
            landmark: string | null;
        }> = [];

        for (let i = 0; i < maxTabs; i++) {
            await page.keyboard.press('Tab');
            await new Promise(resolve => setTimeout(resolve, 100));

            const focused = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el || el === document.body) return null;

                let landmark: string | null = null;
                let current: Element | null = el;
                while (current) {
                    const role = current.getAttribute('role');
                    if (role && ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form', 'region'].includes(role)) {
                        landmark = role;
                        break;
                    }
                    const tag = current.tagName.toLowerCase();
                    if (tag === 'header') { landmark = 'banner'; break; }
                    if (tag === 'nav') { landmark = 'navigation'; break; }
                    if (tag === 'main') { landmark = 'main'; break; }
                    if (tag === 'aside') { landmark = 'complementary'; break; }
                    if (tag === 'footer') { landmark = 'contentinfo'; break; }
                    current = current.parentElement;
                }

                return {
                    tag: el.tagName.toLowerCase(),
                    role: el.getAttribute('role') || el.tagName.toLowerCase(),
                    name: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 50) || '',
                    landmark,
                };
            });

            if (!focused) continue;

            focusedElements.push(focused);

            steps.push({
                action: 'tab-focus',
                description: `Tab ${i + 1}: ${focused.role} "${focused.name}"${focused.landmark ? ` (in ${focused.landmark})` : ' (outside landmarks)'}`,
                element: { role: focused.role, name: focused.name },
                timestamp: Date.now(),
            });

            if (focusedElements.length > 2 &&
                focused.tag === focusedElements[0].tag &&
                focused.name === focusedElements[0].name) {
                break;
            }
        }

        const outsideLandmarks = focusedElements.filter(el => !el.landmark);
        if (outsideLandmarks.length > 0) {
            issues.push({
                type: 'tab-not-following-landmarks',
                message: `${outsideLandmarks.length} focusable element(s) are outside any landmark region. Screen reader landmark navigation will skip them.`,
                wcagCriteria: getWcagCriteria('tab-not-following-landmarks'),
                severity: 'moderate',
            });
        }

        return { steps, issues };
    }

    /**
     * Assess overall landmark coverage
     */
    private assessLandmarkCoverage(landmarks: LandmarkEntry[]): string[] {
        const found = new Set(landmarks.map(l => l.role));
        const recommended = ['banner', 'navigation', 'main', 'contentinfo'];
        const missing = recommended.filter(r => !found.has(r));

        if (missing.length === 0) return ['All recommended landmarks present'];
        return missing.map(m => `Missing recommended landmark: ${m}`);
    }

    async close(): Promise<void> {
        if (this.stagehand) {
            await this.stagehand.close();
            this.stagehand = null;
        }
        logger.debug('Screen Reader Navigator closed');
    }
}
