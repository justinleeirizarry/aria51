/**
 * @aria51/core
 *
 * Core library for accessibility testing. Framework-agnostic accessibility
 * scanning with axe-core, keyboard testing, and WCAG 2.2 checks.
 *
 * Includes component attribution (React, Vue, Svelte, Solid, Preact) via element-source.
 * For AI-powered auditing, use @aria51/ai-auditor
 */

// =============================================================================
// Services - Main API
// =============================================================================

export {
    // Browser Service
    BrowserService,
    createBrowserService,
    type BrowserServiceConfig,
    type NavigateOptions,
    type StabilityCheckResult,
    type IBrowserService,

    // Scanner Service
    ScannerService,
    createScannerService,
    type ScanExecutionOptions,
    type IScannerService,

    // Results Processor Service
    ResultsProcessorService,
    createResultsProcessorService,
    type ScanMetadata,
    type MCPToolContent,
    type MCPFormatOptions,
    type CIResult,
    type IResultsProcessorService,

    // Orchestration Types (service migrated to Effect-based implementation)
    type BaseScanOptions,
    type ScanOperationResult,
    type ScanProgressStep,
} from './services/index.js';

// =============================================================================
// Effect-based Services
// =============================================================================

export {
    // Effect orchestration
    runScanAsPromise,
    runMultiScanAsPromise,
    performScan,
    performScanWithCleanup,
    type EffectScanOptions,
    type EffectScanResult,
    type PerformScanError,

    // Effect service tags (for dependency injection)
    BrowserService as BrowserServiceTag,
    ScannerService as ScannerServiceTag,
    ResultsProcessorService as ResultsProcessorServiceTag,
    type EffectBrowserService,
    type EffectScannerService,
    type EffectResultsProcessorService,
    type ScanWorkflowServices,

    // Effect layers
    AppLayer,
    AppLayerManual,
    CoreServicesLayer,
    BrowserServiceLive,
    ScannerServiceLive,
    ResultsProcessorServiceLive,
} from './services/effect/index.js';

// =============================================================================
// Types
// =============================================================================

export type {
    // Core types
    ImpactLevel,
    ImpactLevelOrNull,
    SeverityLevel,
    WcagLevel,
    WcagPrinciple,
    WcagCriterionInfo,
    TestabilityLevel,
    BrowserType,

    // Axe-core types
    AxeCheckResult,
    AxeNodeResult,
    AxeResult,
    AxeViolation,

    // Component types
    ComponentInfo,

    // Violation types
    FixSuggestion,
    RelatedNode,
    AttributedCheck,
    AttributedViolation,
    AttributedPass,
    AttributedIncomplete,

    // Keyboard testing types
    KeyboardTestResults,

    // Scan types
    ScanResults,
    ScanOptions,
    ScanError as ScanErrorInfo,
    BrowserScanData,
    BrowserScanOptions,

    // Prompt types
    PromptTemplate,
    PromptContext,
    PromptExportOptions,

    // WCAG 2.2 types
    WCAG22Results,
    WCAG22ViolationSummary,

    // Supplemental results (Stagehand)
    SupplementalTestResult,
    SupplementalIssue,

    // API types
    Aria51ScannerAPI,
} from './types.js';

// =============================================================================
// Errors
// =============================================================================


// ScanError - thrown by runScanAsPromise for well-formatted error messages
export { ScanError, formatTaggedError } from './errors/scan-error.js';

// Domain errors (Data.TaggedError) - preferred for Effect workflows
export {
    ReactNotDetectedError,
    BrowserLaunchError,
    BrowserNotLaunchedError,
    BrowserAlreadyLaunchedError,
    NavigationTimeoutError,
    NavigationError,
    ContextDestroyedError,
    ScannerInjectionError,
    MaxRetriesExceededError,
    ConfigurationError,
    InvalidUrlError,
    FileSystemError,
    ServiceStateError,
    ScanDataError,

    // Error type unions
    type BrowserErrors,
    type ScanErrors,
    type ValidationErrors,
    type ScanWorkflowErrors,
} from './errors/effect-errors.js';

// =============================================================================
// Configuration
// =============================================================================

export {
    getConfig,
    updateConfig,
    loadConfig,
    validateConfiguration,
    resetConfig,
    DEFAULT_CONFIG,
    type ScannerConfig,
    loadEnvConfig,
    hasEnvConfig,
    getSupportedEnvVars,
    getEnvVarDocs,
    loadConfigFile,
} from './config/index.js';

// =============================================================================
// Utilities
// =============================================================================

export { logger, LogLevel } from './utils/logger.js';
export { EXIT_CODES, setExitCode, exitWithCode, type ExitCode } from './utils/exit-codes.js';
export { validateUrl, validateBrowser, validateTags, validateThreshold } from './utils/validation.js';

// =============================================================================
// Prompts
// =============================================================================

export {
    generatePrompt,
    generateAndExport,
    exportPrompt,
} from './prompts/prompt-generator.js';


// =============================================================================
// Suggestions - Contextual fix generation
// =============================================================================

export {
    generateContextualFix,
    hasContextualSupport,
} from './scanner/suggestions/index.js';

// =============================================================================
// Multi-Page Checks
// =============================================================================

export { checkMultiPage } from './scanner/multi-page/index.js';

// =============================================================================
// Plugin System
// =============================================================================

export type {
    FrameworkPlugin,
    FrameworkScanData,
    AttributedNode,
    GenericScanResults,
    GenericScanOptions,
} from './plugin.js';

export type {
    AttributedViolation as PluginAttributedViolation,
    AttributedPass as PluginAttributedPass,
    AttributedIncomplete as PluginAttributedIncomplete,
} from './plugin.js';

// =============================================================================
// WCAG Data
// =============================================================================

export {
    WCAG_CRITERIA,
    getAllCriteria,
    getCriteriaCount,
    AXE_WCAG_MAP,
    getMappedRuleIds,
    hasWcagMapping,
    getAxeMapping,
    getWcagCriteriaForViolation,
    getCriterionById,
    getAllCriteriaByLevel,
    getPrimaryCriterion,
    getHighestLevelForViolation,
    formatCriterionDisplay,
    extractCriteriaFromTags,
    getUniquePrinciples,
    type WcagCriterion,
    type AxeWcagMapping,
} from './data/index.js';

// =============================================================================
// Audits - Pure audit functions (keyboard, structure, screen reader)
// =============================================================================

export {
    auditKeyboard,
    auditStructure,
    auditScreenReader,
    type AuditIssue,
    type KeyboardAuditResult,
    type KeyboardAuditOptions,
    type StructureAuditResult,
    type StructureAuditOptions,
    type ScreenReaderAuditResult,
    type ScreenReaderAuditOptions,
    type TabOrderEntry,
    type LandmarkInfo,
    type HeadingInfo,
    type FormInputInfo,
} from './audits/index.js';

// =============================================================================
// Accessibility Tree
// =============================================================================

// Replaces page.accessibility.snapshot(), removed in Playwright 1.62.
export { getAccessibilityTree } from './utils/accessibility-tree.js';
export type { AccessibilityNode } from './utils/accessibility-tree.js';

// =============================================================================
// Component Attribution
// =============================================================================

export {
    ComponentPlugin,
    getComponentBundlePath,
    getDetectionScript,
    resolveComponent,
    buildAttributedNode,
    generateCssSelector,
    extractHtmlSnippet,
    cleanFilePath,
    isFrameworkComponent,
    filterUserComponents,
    type SourceLocation,
    type ResolvedComponent,
} from './components/index.js';

// =============================================================================
// Audit Pipeline (page discovery, compliance reports, remediation)
// =============================================================================

export {
    // Planning
    parseSitemap,
    discoverLinks,
    deduplicatePages,
    // Verification
    scoreFinding,
    sortByScore,
    filterHighConfidence,
    // Remediation
    generateRemediationPlan,
    // Pipeline
    runFullAudit,
} from './audit/index.js';

export type {
    FullAuditOptions,
    FullAuditResult,
    LinkDiscoveryOptions,
    SitemapEntry,
    DiscoveredPage,
    VerifiedFinding,
    FindingSource,
    ConfidenceLevel as AuditConfidenceLevel,
    ImpactLevel as AuditImpactLevel,
    AgentWcagCriterionInfo,
    RemediationPlan,
    RemediationPhase,
    RemediationItem,
    AuditSessionMinimal,
} from './audit/index.js';
