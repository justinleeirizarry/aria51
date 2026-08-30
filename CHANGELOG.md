# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] — 2026-08-30

### Fixed

- **The structure audit and the screen-reader check threw on any fresh install.**
  Playwright removed `page.accessibility` in 1.62, and this package's dependency
  range is a caret on 1.56, so `npm install` resolved to a Playwright without
  that API and both paths failed with `Cannot read properties of undefined
  (reading 'snapshot')`. Existing checkouts with an older lockfile never saw it.

  The accessibility tree is now read through CDP `Accessibility.getFullAXTree`,
  which is stable across versions, and reshaped into the tree Playwright used to
  return. Output was verified identical to the old API on Playwright 1.56 across
  pages with and without headings, and verified working on 1.62.

  Affected `auditStructure`, the WCAG screen-reader check, the MCP
  `get_accessibility_tree` tool, and both ai-auditor browser paths.

### Added

- `getAccessibilityTree(page)` and the `AccessibilityNode` type are exported from
  `@aria51/core` for callers that used `page.accessibility.snapshot()` directly.

## [0.2.0] — 2026-08-30

### Fixed

- **Keyboard checks no longer report a focus trap that does not exist.** Element
  identity was a display selector built from `tag#id.class`, which is not unique:
  links carrying no id and no class all serialise to `"a"`, and links sharing one
  class — the ordinary output of CSS modules and utility-class frameworks — all
  serialise to `"a.nav-link"`. Three such siblings in a row looked like the same
  element focused three times, raising a critical WCAG 2.1.2 violation against
  perfectly correct markup. Identity is now a structural path, unique per element.

- **Keyboard reachability counts were badly understated.** The same non-unique
  selector terminated the tab walk on its third stop, and in the scan path
  deduplicated every class-less link on a page down to a single entry. Hacker
  News measured 3 of 229 reachable; it is 230 of 230.

- **Truncated tab walks are no longer reported as unreachable elements.** A walk
  that exhausts its step budget yields a floor, not a measurement. Results now
  carry a `terminationReason` (`cycled`, `trapped`, `exhausted`, `capped`), and a
  capped walk emits an explicit "could not be measured" notice instead of a
  reachability claim.

- The tabbable denominator excluded nothing. `tabindex="-1"`, disabled, `inert`,
  and elements with no layout box were all counted as reachable targets.

- `page.evaluate` callbacks no longer declare named inner functions. Bundlers
  that preserve function names inject a `__name` helper that is undefined inside
  the page context and throws at evaluate time.

- `tsconfig.json` referenced `packages/agent`, which no longer exists, breaking
  test collection with a tsconfck parse error.

### Added

- `KeyboardAuditResult.uniqueTabStops` — distinct elements reached. Use this
  against `tabbableCount`; `tabStops` counts presses and can exceed the element
  count when focus revisits.
- `KeyboardAuditResult.tabbableCount` — the honest denominator.
- `KeyboardAuditResult.terminationReason`.
- `TabOrderEntry.uid` — structural path. `selector` remains display-only.
- `KeyboardAuditOptions.tabDelayMs`.
- Integration tests now run in CI via `pnpm test:integration`. They were excluded
  from the default suite, so despite CI installing Chromium no test had ever
  exercised a real page — which is why the defects above went unnoticed.
- `test/fixtures/keyboard-classless-links.html`, reproducing both failure modes.

### Changed

- Default `maxTabs` raised from 50 to 250; per-tab settle time reduced from 100ms
  to 50ms, capping a full walk at roughly 12 seconds.

## [0.1.4] — 2026-04-24

Initial published release line.
