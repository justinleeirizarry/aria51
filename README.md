# aria51

Accessibility testing for keyboard navigation, focus management, screen reader compatibility, and WCAG 2.2 checks that require real browser interaction.

<p align="center">
  <img src="assets/hero.gif" alt="aria51 scanning Hacker News and finding accessibility violations" width="700">
</p>

## Quick Start

```bash
npx aria51 https://your-site.com
```

Runs instantly with zero config, no API key, and no setup.

### Focused Audits

Test specific accessibility dimensions through real browser interaction:

```bash
# Keyboard: tab order, focus traps, skip links, focus indicators
npx aria51 https://your-site.com --audit-keyboard

# Structure: landmarks, heading hierarchy, form labels
npx aria51 https://your-site.com --audit-structure

# Screen reader: alt text, ARIA roles, page language, labels, live regions
npx aria51 https://your-site.com --audit-screen-reader
```

<p align="center">
  <img src="assets/keyboard.gif" alt="aria51 keyboard audit output" width="700">
</p>

<p align="center">
  <img src="assets/screen-reader.gif" alt="aria51 screen reader audit output" width="700">
</p>

### Full WCAG Compliance Audit

Run a complete multi-page audit with one command, no API key needed:

```bash
npx aria51 https://your-site.com --full-audit
npx aria51 https://your-site.com --full-audit --max-pages 20
```

Discovers pages via sitemap and link crawling, scans every page with axe-core, runs keyboard/structure/screen-reader audits on key pages, and generates a prioritized remediation plan.

### What aria51 Catches

Combining axe-core with focused browser audits surfaces issues across real interaction paths:

| Site | axe-core alone | + aria51 focused audits |
|------|---------------|------------------------|
| Hacker News | 4 violations | + only 3 of 229 interactive elements reachable via keyboard |
| GitHub | 4 violations | + 72 tab-order, 104 focus-indicator, 15 widget keyboard issues |
| Wikipedia | 0 violations | + 699 keyboard navigation issues |
| Stripe | 0 violations | + 215 keyboard navigation issues |

## MCP Server

aria51 ships as an MCP server so AI coding assistants can test accessibility directly. The workflow becomes: **scan a URL, see violations, fix the code, re-scan to verify**, all within the assistant's loop.

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "aria51": {
      "command": "npx",
      "args": ["-y", "@aria51/mcp"]
    }
  }
}
```

### Cursor / Windsurf

Add `aria51-mcp` as an MCP command in your editor's MCP settings.

### Available Tools

| Tool | Description |
|------|-------------|
| `scan_url` | Scan a URL for accessibility violations |
| `scan_urls` | Batch scan multiple URLs |
| `get_accessibility_tree` | Get page semantic structure |
| `explain_violation` | Explain an axe-core rule and how to fix it |
| `list_wcag_criteria` | Look up WCAG 2.2 criteria by level, principle, or keyword |
| `test_keyboard` | Test keyboard navigation (tab order, focus traps, indicators) |
| `analyze_structure` | Analyze landmarks, headings, form labels |
| `test_screen_reader` | Simulate screen reader navigation |
| `discover_pages` | Find all pages on a site via sitemap + link crawling |
| `run_full_audit` | Complete WCAG compliance audit with remediation plan |

## CI Integration

```bash
# Exit code 1 if any violations found
npx aria51 https://your-site.com --ci --threshold 0

# Allow up to 5 violations
npx aria51 https://your-site.com --ci --threshold 5

# JSON output for automation
npx aria51 https://your-site.com --output report.json
```

### GitHub Actions

```yaml
- name: Accessibility check
  run: npx aria51 https://your-staging-url.com --ci --threshold 0
```

## CLI Reference

```bash
# Multiple URLs
npx aria51 https://your-site.com https://your-site.com/about

# Browser options
npx aria51 https://your-site.com --browser firefox
npx aria51 https://your-site.com --mobile
npx aria51 https://your-site.com --headless=false

# Filtering
npx aria51 https://your-site.com --tags wcag2aa
npx aria51 https://your-site.com --disable-rules color-contrast
npx aria51 https://your-site.com --exclude ".cookie-banner,.modal"

# Component attribution (auto-detected for React, Vue, Svelte, Solid)
npx aria51 https://your-site.com --no-components  # disable

# AI-enhanced deep analysis (requires OPENAI_API_KEY)
npx aria51 https://your-site.com --audit-keyboard --deep
```

## Packages

| Package | Description |
|---------|-------------|
| [`@aria51/core`](packages/core) | Scanning engine, focused audits, full audit pipeline, WCAG 2.2 checks, component attribution |
| [`@aria51/ai-auditor`](packages/ai-auditor) | AI-enhanced deep analysis via Stagehand |
| [`aria51`](packages/cli) | Terminal interface. Binary: `aria51` |
| [`@aria51/mcp`](packages/mcp) | MCP server with 10 tools for AI assistant integration |

## Documentation

- [Introduction](docs/introduction.md): Architecture and how the pieces fit together
- [CI Integration](docs/ci.md): CI/CD setup and configuration
- [WCAG 2.2 Reference](docs/WCAG-2.2.md): All 86 success criteria
- [Effect Architecture](docs/effect-service-breakdown.md): Core scanning engine internals

## Development

```bash
# Install dependencies and build
pnpm install && pnpm build

# Watch mode (all packages)
pnpm dev

# Run tests
pnpm test

# Build/test a specific package
pnpm --filter @aria51/core build
pnpm --filter @aria51/core test
```

**Requirements:** Node.js 18+, pnpm 8+, Playwright browsers (`npx playwright install chromium`)

## Built With

- [axe-core](https://github.com/dequelabs/axe-core): Automated WCAG violation detection
- [Playwright](https://playwright.dev): Browser automation for keyboard and screen reader testing
- [Stagehand](https://github.com/browserbase/stagehand): AI-powered browser interaction for `--deep` mode
- [Effect](https://effect.website): Composable error handling and resource management
- [element-source](https://github.com/aidenybai/element-source): Maps DOM nodes to framework component source locations

## License

[MIT](LICENSE)
