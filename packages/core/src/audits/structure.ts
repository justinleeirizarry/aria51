/**
 * Structure Audit
 *
 * Pure function that analyzes a page's accessibility structure using Playwright.
 */
import { chromium } from 'playwright';
import type { StructureAuditResult, StructureAuditOptions, LandmarkInfo, HeadingInfo, FormInputInfo, AuditIssue } from './types.js';
import { getAccessibilityTree } from '../utils/accessibility-tree.js';

export async function auditStructure(
    url: string,
    options: StructureAuditOptions = {}
): Promise<StructureAuditResult> {
    const { headless = true, page: externalPage } = options;
    const browser = externalPage ? null : await chromium.launch({ headless });

    try {
        const page = externalPage || await browser!.newPage({ bypassCSP: true });
        if (!externalPage) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // page.accessibility was removed in Playwright 1.62; read it over CDP.
        const tree = await getAccessibilityTree(page);
        const title = await page.title();
        const issues: AuditIssue[] = [];

        const landmarks: LandmarkInfo[] = await page.evaluate(() => {
            const landmarkRoles = ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'region', 'form'];
            const results: Array<{ role: string; label: string; tag: string }> = [];

            for (const role of landmarkRoles) {
                document.querySelectorAll(`[role="${role}"]`).forEach(el => {
                    results.push({ role, label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '', tag: el.tagName.toLowerCase() });
                });
            }

            const semanticMap: Record<string, string> = {
                header: 'banner', nav: 'navigation', main: 'main',
                aside: 'complementary', footer: 'contentinfo', form: 'form', search: 'search',
            };
            for (const [tag, role] of Object.entries(semanticMap)) {
                document.querySelectorAll(tag).forEach(el => {
                    if (!el.getAttribute('role')) {
                        results.push({ role, label: el.getAttribute('aria-label') || '', tag });
                    }
                });
            }
            return results;
        });

        const headings: HeadingInfo[] = await page.evaluate(() => {
            const results: Array<{ level: number; text: string; id: string }> = [];
            document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
                results.push({ level: parseInt(el.tagName[1]), text: (el as HTMLElement).innerText?.slice(0, 80) || '', id: el.id || '' });
            });
            return results;
        });

        const formInputs: FormInputInfo[] = await page.evaluate(() => {
            const results: Array<{ type: string; name: string; hasLabel: boolean; labelText: string }> = [];
            document.querySelectorAll('input, select, textarea').forEach(el => {
                const input = el as HTMLInputElement;
                if (input.type === 'hidden') return;
                const id = input.id;
                const label = id ? document.querySelector(`label[for="${id}"]`) : null;
                const ariaLabel = input.getAttribute('aria-label');
                const hasLabel = !!(label || ariaLabel || input.getAttribute('aria-labelledby') || input.getAttribute('title'));
                results.push({
                    type: input.type || input.tagName.toLowerCase(),
                    name: input.name || input.id || '',
                    hasLabel,
                    labelText: ariaLabel || (label as HTMLElement)?.innerText?.slice(0, 50) || '',
                });
            });
            return results;
        });

        // Analyze
        if (!title || title.trim() === '') {
            issues.push({ severity: 'serious', wcag: '2.4.2', message: 'Page has no title' });
        }

        if (!landmarks.some(l => l.role === 'main')) {
            issues.push({ severity: 'serious', wcag: '1.3.1', message: 'No main landmark found' });
        }

        const landmarkCounts: Record<string, number> = {};
        for (const l of landmarks) landmarkCounts[l.role] = (landmarkCounts[l.role] || 0) + 1;
        for (const [role, count] of Object.entries(landmarkCounts)) {
            if (count > 1) {
                const labeled = landmarks.filter(l => l.role === role && l.label).length;
                if (labeled < count) {
                    issues.push({ severity: 'moderate', wcag: '1.3.1', message: `${count} "${role}" landmarks but ${count - labeled} unlabeled — screen readers can't distinguish them` });
                }
            }
        }

        const h1Count = headings.filter(h => h.level === 1).length;
        if (h1Count === 0) issues.push({ severity: 'moderate', wcag: '2.4.6', message: 'No h1 heading found' });
        if (h1Count > 1) issues.push({ severity: 'moderate', wcag: '2.4.6', message: `${h1Count} h1 headings found — pages should typically have one` });

        for (let i = 1; i < headings.length; i++) {
            if (headings[i].level > headings[i - 1].level + 1) {
                issues.push({ severity: 'moderate', wcag: '1.3.1', message: `Heading level skipped: h${headings[i - 1].level} → h${headings[i].level} ("${headings[i].text.slice(0, 30)}")` });
            }
        }

        const emptyHeadings = headings.filter(h => !h.text.trim());
        if (emptyHeadings.length > 0) {
            issues.push({ severity: 'moderate', wcag: '2.4.6', message: `${emptyHeadings.length} empty heading(s) found` });
        }

        const unlabeled = formInputs.filter(f => !f.hasLabel);
        if (unlabeled.length > 0) {
            issues.push({ severity: 'critical', wcag: '4.1.2', message: `${unlabeled.length} form input(s) without labels: ${unlabeled.slice(0, 3).map(f => f.type + (f.name ? `[${f.name}]` : '')).join(', ')}` });
        }

        return {
            url,
            timestamp: new Date().toISOString(),
            title: title || '',
            landmarks,
            headings,
            formInputs,
            accessibilityTree: tree,
            issues,
        };
    } finally {
        if (browser) await browser.close();
    }
}
