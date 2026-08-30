#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect } from "effect";
import { z } from "zod";
import {
    runScanAsPromise,
    runMultiScanAsPromise,
    AppLayer,
    createResultsProcessorService,
    logger,
    EXIT_CODES,
    exitWithCode,
    updateConfig,
    loadEnvConfig,
    hasEnvConfig,
    getComponentBundlePath,
    getAccessibilityTree,
} from "@aria51/core";

// Configure logger to use stderr to avoid corrupting JSON-RPC on stdout
logger.setUseStderr(true);

// Load configuration from environment variables
if (hasEnvConfig()) {
    updateConfig(loadEnvConfig());
}

// Create server instance
const server = new McpServer({
    name: "aria51",
    version: "1.0.0",
});

// Register scan tool
server.registerTool(
    "scan_url",
    {
        description: "Scan a URL for accessibility violations",
        inputSchema: {
            url: z.string().url().describe("The URL to scan"),
            browser: z.enum(["chromium", "firefox", "webkit"]).optional().default("chromium").describe("Browser to use for scanning"),
            mobile: z.boolean().optional().default(false).describe("Emulate a mobile device"),
            include_tree: z.boolean().optional().default(false).describe("Include the full accessibility tree in the response (can be large)"),
            components: z.boolean().optional().default(true).describe("Auto-detect and attribute violations to framework components (React, Vue, Svelte, Solid). Set false to disable."),
            disable_rules: z.array(z.string()).optional().describe("Axe rule IDs to disable (e.g. ['color-contrast'])"),
            exclude: z.array(z.string()).optional().describe("CSS selectors to exclude from scanning"),
            tags: z.array(z.string()).optional().describe("Axe-core tags to filter by (e.g. ['wcag2a', 'wcag2aa', 'best-practice'])"),
            stagehand: z.boolean().optional().default(false).describe("Enable AI-powered tests (keyboard navigation, tree analysis, screen reader). Requires OPENAI_API_KEY."),
            stagehand_model: z.string().optional().describe("AI model for Stagehand tests (default: openai/gpt-4o-mini)"),
        },
    },
    async ({ url, browser, mobile, include_tree, components, disable_rules, exclude, tags, stagehand, stagehand_model }) => {
        try {
            logger.info(`Starting scan for ${url} using ${browser}${stagehand ? ' with Stagehand AI tests' : ''}`);

            const { results } = await runScanAsPromise({
                url,
                browser: browser as "chromium" | "firefox" | "webkit",
                headless: true,
                includeKeyboardTests: true,
                componentBundlePath: components !== false ? getComponentBundlePath() : undefined,
                mobile,
                disableRules: disable_rules,
                exclude,
                tags,
                stagehand,
                stagehandModel: stagehand_model,
            }, AppLayer);

            const processor = createResultsProcessorService();
            const content = Effect.runSync(processor.formatForMCP(results, { includeTree: include_tree }));

            return {
                content,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Scan failed: ${errorMessage}`);
            return {
                content: [
                    {
                        type: "text",
                        text: `Scan failed: ${errorMessage}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// Register multi-URL scan tool
server.registerTool(
    "scan_urls",
    {
        description: "Scan multiple URLs for accessibility violations",
        inputSchema: {
            urls: z.array(z.string().url()).min(1).describe("The URLs to scan"),
            browser: z.enum(["chromium", "firefox", "webkit"]).optional().default("chromium").describe("Browser to use for scanning"),
            mobile: z.boolean().optional().default(false).describe("Emulate a mobile device"),
            include_tree: z.boolean().optional().default(false).describe("Include the full accessibility tree in the response (can be large)"),
            components: z.boolean().optional().default(true).describe("Auto-detect and attribute violations to framework components (React, Vue, Svelte, Solid). Set false to disable."),
            disable_rules: z.array(z.string()).optional().describe("Axe rule IDs to disable (e.g. ['color-contrast'])"),
            exclude: z.array(z.string()).optional().describe("CSS selectors to exclude from scanning"),
            tags: z.array(z.string()).optional().describe("Axe-core tags to filter by (e.g. ['wcag2a', 'wcag2aa', 'best-practice'])"),
            stagehand: z.boolean().optional().default(false).describe("Enable AI-powered tests (keyboard navigation, tree analysis, screen reader). Requires OPENAI_API_KEY."),
            stagehand_model: z.string().optional().describe("AI model for Stagehand tests (default: openai/gpt-4o-mini)"),
        },
    },
    async ({ urls, browser, mobile, include_tree, components, disable_rules, exclude, tags, stagehand, stagehand_model }) => {
        try {
            logger.info(`Starting multi-page scan for ${urls.length} URLs using ${browser}${stagehand ? ' with Stagehand AI tests' : ''}`);

            const scanResults = await runMultiScanAsPromise(
                urls,
                {
                    browser: browser as "chromium" | "firefox" | "webkit",
                    headless: true,
                    includeKeyboardTests: true,
                    componentBundlePath: components !== false ? getComponentBundlePath() : undefined,
                    mobile,
                    disableRules: disable_rules,
                    exclude,
                    tags,
                    stagehand,
                    stagehandModel: stagehand_model,
                },
                AppLayer,
            );

            const processor = createResultsProcessorService();
            const allContent: Array<{ type: "text"; text: string }> = [];

            for (let i = 0; i < scanResults.length; i++) {
                const { results } = scanResults[i];
                const content = Effect.runSync(processor.formatForMCP(results, { includeTree: include_tree }));
                if (urls.length > 1) {
                    allContent.push({ type: "text" as const, text: `\n--- Results for ${urls[i]} ---\n` });
                }
                allContent.push(...content);
            }

            return { content: allContent };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Multi-page scan failed: ${errorMessage}`);
            return {
                content: [{ type: "text", text: `Scan failed: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// Register accessibility tree tool
server.registerTool(
    "get_accessibility_tree",
    {
        description: "Get the accessibility tree for a URL. Returns the page's semantic structure including headings, landmarks, ARIA roles, and interactive elements. Lightweight — does not run a full accessibility scan. Works on CSP-restricted sites.",
        inputSchema: {
            url: z.string().url().describe("The URL to analyze"),
            browser: z.enum(["chromium", "firefox", "webkit"]).optional().default("chromium").describe("Browser to use"),
        },
    },
    async ({ url, browser }) => {
        try {
            logger.info(`Getting accessibility tree for ${url}`);
            const { chromium, firefox, webkit } = await import("playwright");
            const browsers = { chromium, firefox, webkit };
            const browserInstance = await browsers[browser as keyof typeof browsers].launch({ headless: true });
            const page = await browserInstance.newPage();
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
            const snapshot = await getAccessibilityTree(page);
            await browserInstance.close();

            return {
                content: [{
                    type: "text",
                    text: `## Accessibility Tree for ${url}\n\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\``,
                }],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Failed to get accessibility tree: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// Register explain violation tool
server.registerTool(
    "explain_violation",
    {
        description: "Explain an axe-core accessibility rule — what WCAG criteria it maps to, what it means, and how to fix it. Use this to understand a specific violation without running a scan.",
        inputSchema: {
            rule_id: z.string().describe("The axe-core rule ID (e.g., 'color-contrast', 'image-alt', 'link-name')"),
        },
    },
    async ({ rule_id }) => {
        const {
            getWcagCriteriaForViolation,
            AXE_WCAG_MAP,
        } = await import("@aria51/core");

        const mapping = AXE_WCAG_MAP[rule_id];
        if (!mapping) {
            return {
                content: [{ type: "text", text: `Unknown rule ID: "${rule_id}". This is not a recognized axe-core rule.` }],
                isError: true,
            };
        }

        const criteria = getWcagCriteriaForViolation(rule_id);
        const lines: string[] = [
            `## ${rule_id}`,
            ``,
            `**Axe Rule:** https://dequeuniversity.com/rules/axe/4.8/${rule_id}`,
            `**WCAG Criteria:** ${mapping.criteria.join(", ")}`,
            mapping.techniques ? `**Techniques:** ${mapping.techniques.join(", ")}` : '',
            ``,
            `### Mapped WCAG Criteria`,
        ].filter(Boolean);

        for (const c of criteria) {
            lines.push(`- **${c.id} ${c.title}** (Level ${c.level}, ${c.principle})`);
            lines.push(`  ${c.description}`);
            lines.push(`  [W3C Understanding](${c.w3cUrl})`);
        }

        return {
            content: [{ type: "text", text: lines.join("\n") }],
        };
    }
);

// Register WCAG criteria listing tool
server.registerTool(
    "list_wcag_criteria",
    {
        description: "List WCAG 2.2 success criteria, optionally filtered by conformance level (A, AA, AAA) or principle (Perceivable, Operable, Understandable, Robust). Use this to look up specific WCAG requirements without relying on training data.",
        inputSchema: {
            level: z.enum(["A", "AA", "AAA"]).optional().describe("Filter by conformance level"),
            principle: z.enum(["Perceivable", "Operable", "Understandable", "Robust"]).optional().describe("Filter by WCAG principle"),
            search: z.string().optional().describe("Search criteria by title or description (case-insensitive)"),
        },
    },
    async ({ level, principle, search }) => {
        const { getAllCriteria } = await import("@aria51/core");

        let criteria = getAllCriteria();
        if (level) criteria = criteria.filter((c: any) => c.level === level);
        if (principle) criteria = criteria.filter((c: any) => c.principle === principle);
        if (search) {
            const q = search.toLowerCase();
            criteria = criteria.filter((c: any) =>
                c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
            );
        }

        if (criteria.length === 0) {
            return { content: [{ type: "text", text: "No criteria matched the filters." }] };
        }

        const lines = [`## WCAG 2.2 Criteria (${criteria.length} results)\n`];
        for (const c of criteria) {
            lines.push(`- **${c.id} ${c.title}** (Level ${c.level}, ${c.principle})`);
            lines.push(`  ${c.description}`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
    }
);

// Register keyboard audit tool
server.registerTool(
    "test_keyboard",
    {
        description: "Test keyboard navigation on a page by pressing Tab and analyzing focus behavior. Returns tab order, focus trap detection, focus indicator presence, and skip link status. Use for WCAG 2.1.1, 2.1.2, 2.4.1, 2.4.3, 2.4.7 checks. Set deep=true for AI-enhanced analysis (requires OPENAI_API_KEY).",
        inputSchema: {
            url: z.string().url().describe("The URL to test"),
            max_tabs: z.number().optional().default(50).describe("Maximum Tab presses (default: 50)"),
            deep: z.boolean().optional().default(false).describe("Enable AI-enhanced deep analysis (requires OPENAI_API_KEY)"),
        },
    },
    async ({ url, max_tabs, deep }) => {
        try {
            let result: any;
            if (deep) {
                const { deepAuditKeyboard } = await import("@aria51/ai-auditor");
                result = await deepAuditKeyboard(url, { maxTabs: max_tabs });
            } else {
                const { auditKeyboard } = await import("@aria51/core");
                result = await auditKeyboard(url, { maxTabs: max_tabs });
            }
            const lines = [
                `## Keyboard Navigation: ${url}\n`,
                `- Tab stops: ${result.tabStops} / ${result.totalInteractive} interactive elements`,
                `- Focus trap: ${result.focusTrapDetected ? '**YES**' : 'no'}`,
                `- Skip link: ${result.hasSkipLink ? 'yes' : '**NO**'}`,
                `- Missing focus indicators: ${result.elementsWithoutFocusIndicator}\n`,
            ];
            if (result.issues.length > 0) {
                lines.push('### Issues');
                for (const i of result.issues) lines.push(`- **[${i.severity}] WCAG ${i.wcag}:** ${i.message}`);
                lines.push('');
            }
            lines.push('### Tab Order');
            for (const e of result.tabOrder.slice(0, 25)) {
                lines.push(`${e.index}. ${e.hasFocusStyle ? '✓' : '✗'} ${e.role} "${e.name.slice(0, 40)}" — ${e.selector}`);
            }
            if (result.tabOrder.length > 25) lines.push(`... ${result.tabOrder.length - 25} more`);
            if (result.deep && result.deepAnalysis) {
                lines.push('\n### Deep Analysis (AI-enhanced)');
                const da = result.deepAnalysis;
                if (da.issues?.length > 0) {
                    for (const i of da.issues) lines.push(`- **[${i.severity || i.impact || ''}]** ${i.description || i.message || i.element || ''}`);
                }
                if (da.summary) lines.push(`\n${da.summary}`);
            }
            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Keyboard test failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
        }
    }
);

// Register structure audit tool
server.registerTool(
    "analyze_structure",
    {
        description: "Analyze a page's accessibility structure: landmarks, heading hierarchy, ARIA roles, form labels, and the accessibility tree. Use for WCAG 1.3.1, 2.4.2, 2.4.6, 4.1.2 checks. Set deep=true for AI-enhanced analysis (requires OPENAI_API_KEY).",
        inputSchema: {
            url: z.string().url().describe("The URL to analyze"),
            deep: z.boolean().optional().default(false).describe("Enable AI-enhanced deep analysis (requires OPENAI_API_KEY)"),
        },
    },
    async ({ url, deep }) => {
        try {
            let result: any;
            if (deep) {
                const { deepAuditStructure } = await import("@aria51/ai-auditor");
                result = await deepAuditStructure(url);
            } else {
                const { auditStructure } = await import("@aria51/core");
                result = await auditStructure(url);
            }
            const lines = [
                `## Structure Analysis: ${url}\n`,
                `- Title: ${result.title || '(empty)'}`,
                `- Landmarks: ${result.landmarks.length}`,
                `- Headings: ${result.headings.length} (h1: ${result.headings.filter((h: any) => h.level === 1).length})`,
                `- Form inputs: ${result.formInputs.length} (${result.formInputs.filter((f: any) => !f.hasLabel).length} unlabeled)\n`,
            ];
            if (result.issues.length > 0) {
                lines.push('### Issues');
                for (const i of result.issues) lines.push(`- **[${i.severity}] WCAG ${i.wcag}:** ${i.message}`);
                lines.push('');
            }
            lines.push('### Headings');
            for (const h of result.headings.slice(0, 20)) lines.push(`${'  '.repeat(h.level - 1)}h${h.level}: ${h.text || '(empty)'}`);
            lines.push('\n### Landmarks');
            for (const l of result.landmarks) lines.push(`- ${l.role}${l.label ? ` "${l.label}"` : ''} (${l.tag})`);
            if (result.formInputs.length > 0) {
                lines.push('\n### Form Inputs');
                for (const f of result.formInputs.slice(0, 10)) {
                    lines.push(`- ${f.hasLabel ? '✓' : '✗'} ${f.type}${f.name ? ` "${f.name}"` : ''} — ${f.hasLabel ? f.labelText : 'NO LABEL'}`);
                }
            }
            if (result.deep && result.deepAnalysis) {
                lines.push('\n### Deep Analysis (AI-enhanced)');
                const da = result.deepAnalysis;
                if (da.issues?.length > 0) {
                    for (const i of da.issues) lines.push(`- **[${i.severity || i.type || ''}]** ${i.description || i.message || ''}`);
                }
                if (da.summary) lines.push(`\n${da.summary}`);
            }
            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Structure analysis failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
        }
    }
);

// Register screen reader audit tool
server.registerTool(
    "test_screen_reader",
    {
        description: "Simulate screen reader navigation on a page. Tests page title, language, image alt text, link/button accessible names, form labels, and ARIA live regions. Use for WCAG 1.1.1, 1.3.1, 2.4.1, 2.4.4, 3.3.2, 4.1.2 checks. Set deep=true for AI-enhanced analysis (requires OPENAI_API_KEY).",
        inputSchema: {
            url: z.string().url().describe("The URL to test"),
            deep: z.boolean().optional().default(false).describe("Enable AI-enhanced deep analysis (requires OPENAI_API_KEY)"),
        },
    },
    async ({ url, deep }) => {
        try {
            let result: any;
            if (deep) {
                const { deepAuditScreenReader } = await import("@aria51/ai-auditor");
                result = await deepAuditScreenReader(url);
            } else {
                const { auditScreenReader } = await import("@aria51/core");
                result = await auditScreenReader(url);
            }
            const lines = [
                `## Screen Reader Test: ${url}\n`,
                `- Title: ${result.title ? `"${result.title}"` : '(none)'}`,
                `- Language: ${result.lang || '(not set)'}`,
                `- Images: ${result.images.total} total, ${result.images.missingAlt} missing alt`,
                `- Links: ${result.links.total} total, ${result.links.noName} no name, ${result.links.vague} vague`,
                `- Buttons: ${result.buttons.total} total, ${result.buttons.noName} no name`,
                `- Form inputs: ${result.formInputs.total} total, ${result.formInputs.unlabeled} unlabeled`,
                `- Live regions: ${result.liveRegions}\n`,
            ];
            if (result.issues.length > 0) {
                lines.push('### Issues');
                for (const i of result.issues) lines.push(`- **[${i.severity}] WCAG ${i.wcag}:** ${i.message}`);
            } else {
                lines.push('No critical screen reader issues detected.');
            }
            if (result.deep && result.deepAnalysis) {
                lines.push('\n### Deep Analysis (AI-enhanced)');
                const da = result.deepAnalysis;
                if (da.issues?.length > 0) {
                    for (const i of da.issues) lines.push(`- **[${i.severity || i.type || ''}]** ${i.description || i.message || ''}`);
                }
                if (da.summary) lines.push(`\n${da.summary}`);
            }
            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Screen reader test failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
        }
    }
);

// ─────────────────────────────────────────────────────────────
// discover_pages — Find all pages on a site via sitemap + crawl
// ─────────────────────────────────────────────────────────────

server.tool(
    "discover_pages",
    "Discover all pages on a website via sitemap parsing and/or link crawling. Returns a prioritized list of URLs for scanning. No API key needed.",
    {
        url: z.string().url().describe("The base URL to discover pages for"),
        max_pages: z.number().optional().default(20).describe("Maximum pages to return (default: 20)"),
        strategy: z.enum(["sitemap", "crawl", "both"]).optional().default("both")
            .describe("Discovery strategy: sitemap parsing, Playwright link crawling, or both"),
    },
    async ({ url, max_pages, strategy }) => {
        try {
            logger.info(`Discovering pages for ${url} (strategy: ${strategy}, max: ${max_pages})`);

            const { parseSitemap, discoverLinks, deduplicatePages } = await import("@aria51/core");

            let sitemapEntries: Array<{ url: string; lastmod?: string; priority?: number }> = [];
            let crawledUrls: string[] = [];

            if (strategy === "sitemap" || strategy === "both") {
                try {
                    sitemapEntries = await parseSitemap(url);
                    logger.info(`Sitemap: found ${sitemapEntries.length} entries`);
                } catch (err) {
                    logger.info(`Sitemap parsing failed (non-fatal): ${err}`);
                }
            }

            if (strategy === "crawl" || strategy === "both") {
                try {
                    crawledUrls = await discoverLinks(url, { browser: 'chromium', headless: true });
                    logger.info(`Crawl: found ${crawledUrls.length} links`);
                } catch (err) {
                    logger.info(`Link crawling failed (non-fatal): ${err}`);
                }
            }

            const allUrls = [
                url,
                ...sitemapEntries.map((e) => e.url),
                ...crawledUrls,
            ];

            const pages = deduplicatePages(allUrls, sitemapEntries, max_pages);

            const lines: string[] = [
                `# Discovered Pages for ${url}`,
                '',
                `Found **${pages.length}** pages (from ${sitemapEntries.length} sitemap entries + ${crawledUrls.length} crawled links).`,
                '',
                '| # | URL | Sitemap Priority | Last Modified |',
                '|---|-----|-----------------|---------------|',
            ];

            for (let i = 0; i < pages.length; i++) {
                const p = pages[i];
                const shortUrl = p.url.replace(/^https?:\/\//, '');
                lines.push(`| ${i + 1} | ${shortUrl} | ${p.sitemapPriority ?? '—'} | ${p.lastmod ?? '—'} |`);
            }

            return {
                content: [{ type: "text", text: lines.join("\n") }],
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error(`Page discovery failed: ${msg}`);
            return {
                content: [{ type: "text", text: `Page discovery failed: ${msg}` }],
                isError: true,
            };
        }
    }
);

// ─────────────────────────────────────────────────────────────
// run_full_audit — Complete WCAG compliance audit, no API key
// ─────────────────────────────────────────────────────────────

server.tool(
    "run_full_audit",
    "Run a complete WCAG compliance audit on a website. Discovers pages, scans with axe-core, runs keyboard/structure/screen-reader audits, and generates a prioritized remediation plan. No API key needed — all checks are deterministic.",
    {
        url: z.string().url().describe("The URL to audit"),
        max_pages: z.number().optional().default(10).describe("Maximum pages to scan (default: 10)"),
        include_audits: z.boolean().optional().default(true)
            .describe("Run keyboard, structure, and screen reader focused audits on key pages (default: true)"),
        wcag_level: z.enum(["A", "AA", "AAA"]).optional().default("AA")
            .describe("Target WCAG conformance level (default: AA)"),
    },
    async ({ url, max_pages, include_audits, wcag_level }) => {
        try {
            const { runFullAudit } = await import("@aria51/core");
            const { formatFullAuditReport } = await import("./formatters/audit-report-formatter.js");

            const result = await runFullAudit({
                url,
                maxPages: max_pages,
                includeAudits: include_audits,
                wcagLevel: wcag_level,
            });

            const content = formatFullAuditReport(result);
            return { content };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error(`Full audit failed: ${msg}`);
            return {
                content: [{ type: "text", text: `Full audit failed: ${msg}` }],
                isError: true,
            };
        }
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("aria51 MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    exitWithCode(EXIT_CODES.RUNTIME_ERROR);
});
