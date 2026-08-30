/**
 * Browserbase Session Management
 *
 * Provides utilities for managing browser sessions and live audit workflows.
 */

import type { Stagehand } from '@browserbasehq/stagehand';
import type { BrowserbaseClient, BrowserbaseSession } from './client.js';
import type { WcagAuditResult, AuditFinding } from '../types.js';
import { getAccessibilityTree } from '@aria51/core';

/**
 * Callbacks for streaming audit progress
 */
export interface AuditStreamCallbacks {
    /** Called when audit step changes */
    onProgress?: (step: string, details?: string) => void;
    /** Called when a new finding is discovered */
    onFinding?: (finding: AuditFinding) => void;
    /** Called when audit completes */
    onComplete?: (results: WcagAuditResult) => void;
    /** Called when an error occurs */
    onError?: (error: Error) => void;
}

/**
 * Live audit session with streaming results
 */
export interface LiveAuditSession {
    /** Browserbase session ID */
    sessionId: string;
    /** Live view URL */
    liveViewUrl: string;
    /** Debug URL */
    debugUrl: string;
    /** Stagehand instance */
    stagehand: Stagehand;
    /** Run an audit with streaming callbacks */
    audit: (url: string, callbacks: AuditStreamCallbacks) => Promise<WcagAuditResult>;
    /** Close the session */
    close: () => Promise<void>;
}

/**
 * Create a live audit session with Browserbase
 *
 * @example
 * ```typescript
 * const client = new BrowserbaseClient(config);
 * const session = await createLiveAuditSession(client, { verbose: true });
 *
 * console.log(`Watch live: ${session.liveViewUrl}`);
 *
 * const results = await session.audit('https://example.com', {
 *   onProgress: (step) => console.log(`Progress: ${step}`),
 *   onFinding: (finding) => console.log(`Found: ${finding.description}`),
 * });
 *
 * await session.close();
 * ```
 */
export async function createLiveAuditSession(
    client: BrowserbaseClient,
    options?: {
        model?: string;
        verbose?: boolean;
    }
): Promise<LiveAuditSession> {
    // Create a new Browserbase session
    const browserbaseSession = await client.createSession();

    // Create a Stagehand instance
    const stagehand = await client.createStagehand(browserbaseSession.sessionId, options);

    return {
        sessionId: browserbaseSession.sessionId,
        liveViewUrl: browserbaseSession.liveViewUrl,
        debugUrl: browserbaseSession.debugUrl,
        stagehand,

        async audit(url: string, callbacks: AuditStreamCallbacks): Promise<WcagAuditResult> {
            const findings: AuditFinding[] = [];
            const startTime = Date.now();

            try {
                callbacks.onProgress?.('Navigating to URL', url);

                // Get the page from Stagehand - using any to handle API differences
                const page = (stagehand as any).page;

                // Navigate to the URL
                await page.goto(url, { waitUntil: 'networkidle' });

                callbacks.onProgress?.('Analyzing page structure');

                // Get accessibility tree
                const a11yTree = await getAccessibilityTree(page);

                callbacks.onProgress?.('Running accessibility checks');

                // Inject and run axe-core
                await page.addScriptTag({
                    url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.8.3/axe.min.js',
                });

                const axeResults = await page.evaluate(async () => {
                    const results = await (window as any).axe.run();
                    return results.violations;
                });

                callbacks.onProgress?.('Processing results');

                // Convert axe results to findings
                for (const violation of axeResults as any[]) {
                    const finding: AuditFinding = {
                        criterion: {
                            id: violation.id,
                            title: violation.help,
                            level: 'AA', // Default, could be enhanced
                            principle: 'Perceivable', // Default, could be enhanced
                            w3cUrl: violation.helpUrl,
                        },
                        status: 'fail',
                        description: violation.description,
                        impact: violation.impact,
                        element: violation.nodes?.[0]?.html,
                        selector: violation.nodes?.[0]?.target?.[0],
                    };

                    findings.push(finding);
                    callbacks.onFinding?.(finding);
                }

                const result: WcagAuditResult = {
                    url,
                    timestamp: new Date().toISOString(),
                    targetLevel: 'AA',
                    findings,
                    summary: {
                        passed: 0, // Would need to count passes
                        failed: findings.length,
                        manualReview: 0,
                        pagesVisited: 1,
                        statesChecked: 1,
                    },
                    agentMessage: `Audit completed in ${Date.now() - startTime}ms. Found ${findings.length} issues.`,
                };

                callbacks.onComplete?.(result);
                return result;
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                callbacks.onError?.(err);
                throw err;
            }
        },

        async close(): Promise<void> {
            await stagehand.close();
            await client.closeSession(browserbaseSession.sessionId);
        },
    };
}
