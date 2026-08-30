/**
 * Audit Result Types
 *
 * Typed results for the pure audit functions.
 * These are framework-agnostic — usable from MCP, CLI, web, or agent.
 */

export interface AuditIssue {
    severity: 'critical' | 'serious' | 'moderate' | 'minor';
    wcag: string;
    message: string;
}

// =============================================================================
// Keyboard Audit
// =============================================================================

export interface TabOrderEntry {
    index: number;
    /**
     * Structural path, unique per element. `selector` is for display only and is
     * NOT unique — on markup without ids or classes it collapses to just the tag.
     */
    uid: string;
    tag: string;
    role: string;
    name: string;
    selector: string;
    hasFocusStyle: boolean;
}

/**
 * Why the tab walk stopped.
 *  - cycled:    focus returned to the first stop — a complete, trustworthy pass
 *  - trapped:   focus could not escape an element
 *  - exhausted: focus left the document and did not return
 *  - capped:    hit maxTabs. tabStops is a FLOOR, not a measurement — any ratio
 *               derived from it is invalid and must not be scored.
 */
export type TabTermination = 'cycled' | 'trapped' | 'exhausted' | 'capped';

export interface KeyboardAuditResult {
    url: string;
    timestamp: string;
    /** Tab presses that landed on an element. Revisits are counted more than once. */
    tabStops: number;
    /**
     * Distinct elements reached. This is the numerator to use against
     * tabbableCount — tabStops can exceed the element count when focus revisits.
     */
    uniqueTabStops: number;
    /**
     * Loose count of interactive-looking elements. Overcounts: includes
     * tabindex="-1" and hidden elements. Kept for backwards compatibility —
     * prefer tabbableCount as a denominator.
     */
    totalInteractive: number;
    /**
     * True tabbable denominator. Excludes tabindex="-1", disabled, inert, and
     * elements with no layout box. This is the number tabStops should be
     * compared against.
     */
    tabbableCount: number;
    terminationReason: TabTermination;
    focusTrapDetected: boolean;
    hasSkipLink: boolean;
    elementsWithoutFocusIndicator: number;
    tabOrder: TabOrderEntry[];
    issues: AuditIssue[];
}

export interface KeyboardAuditOptions {
    /** Upper bound on Tab presses. Default 250. */
    maxTabs?: number;
    /** Settle time after each Tab press, in ms. Default 50. */
    tabDelayMs?: number;
    headless?: boolean;
    /** Pre-existing Playwright page — skips browser launch and navigation when provided */
    page?: import('playwright').Page;
}

// =============================================================================
// Structure Audit
// =============================================================================

export interface LandmarkInfo {
    role: string;
    label: string;
    tag: string;
}

export interface HeadingInfo {
    level: number;
    text: string;
    id: string;
}

export interface FormInputInfo {
    type: string;
    name: string;
    hasLabel: boolean;
    labelText: string;
}

export interface StructureAuditResult {
    url: string;
    timestamp: string;
    title: string;
    landmarks: LandmarkInfo[];
    headings: HeadingInfo[];
    formInputs: FormInputInfo[];
    accessibilityTree: any;
    issues: AuditIssue[];
}

export interface StructureAuditOptions {
    headless?: boolean;
    /** Pre-existing Playwright page — skips browser launch and navigation when provided */
    page?: import('playwright').Page;
}

// =============================================================================
// Screen Reader Audit
// =============================================================================

export interface ScreenReaderAuditResult {
    url: string;
    timestamp: string;
    title: string;
    lang: string | null;
    images: { total: number; missingAlt: number };
    links: { total: number; noName: number; vague: number };
    buttons: { total: number; noName: number };
    formInputs: { total: number; unlabeled: number };
    liveRegions: number;
    issues: AuditIssue[];
}

export interface ScreenReaderAuditOptions {
    headless?: boolean;
    /** Pre-existing Playwright page — skips browser launch and navigation when provided */
    page?: import('playwright').Page;
}
