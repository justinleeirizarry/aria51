/**
 * Accessibility tree via CDP.
 *
 * Playwright removed `page.accessibility` in 1.62. This reads the same
 * information through `Accessibility.getFullAXTree`, a stable CDP domain, and
 * reshapes it into the tree Playwright used to return so callers are unchanged.
 *
 * Chromium only — CDP is not available on firefox or webkit. Returns null there
 * rather than throwing; every caller already handles a null tree.
 */
import type { Page, CDPSession } from 'playwright';

export interface AccessibilityNode {
    role: string;
    name: string;
    /** Heading level, for role 'heading'. */
    level?: number;
    value?: string | number;
    description?: string;
    disabled?: boolean;
    focused?: boolean;
    checked?: boolean | 'mixed';
    children?: AccessibilityNode[];
}

/** The subset of CDP's AXNode we consume. */
interface RawAXNode {
    nodeId: string;
    ignored: boolean;
    role?: { value?: string };
    name?: { value?: string };
    description?: { value?: string };
    value?: { value?: string | number };
    properties?: Array<{ name: string; value: { value?: unknown } }>;
    childIds?: string[];
    parentId?: string;
}

function readProperty(node: RawAXNode, name: string): unknown {
    return node.properties?.find(p => p.name === name)?.value?.value;
}

/**
 * Roles that carry no meaning of their own. Playwright's snapshot pruned these;
 * we do the same, hoisting their children into the parent so the shape of the
 * tree matches what callers expect.
 */
const TRANSPARENT_ROLES = new Set(['generic', 'none', 'presentation', 'InlineTextBox']);

function buildNodes(raw: RawAXNode, byId: Map<string, RawAXNode>): AccessibilityNode[] {
    const children = (raw.childIds ?? []).flatMap(id => {
        const child = byId.get(id);
        return child ? buildNodes(child, byId) : [];
    });

    const role = raw.role?.value ?? '';
    const name = raw.name?.value ?? '';

    // Ignored and structurally transparent nodes are replaced by their children
    // rather than dropped, so nothing beneath them is lost.
    if (raw.ignored || TRANSPARENT_ROLES.has(role) || (role === 'StaticText' && !name)) {
        return children;
    }

    // Playwright reported text nodes as 'text'; CDP calls them StaticText.
    const node: AccessibilityNode = { role: role === 'StaticText' ? 'text' : role, name };

    const level = readProperty(raw, 'level');
    if (typeof level === 'number') node.level = level;

    const description = raw.description?.value;
    if (description) node.description = description;

    const value = raw.value?.value;
    if (value !== undefined) node.value = value;

    const disabled = readProperty(raw, 'disabled');
    if (disabled === true) node.disabled = true;

    const focused = readProperty(raw, 'focused');
    if (focused === true) node.focused = true;

    const checked = readProperty(raw, 'checked');
    if (checked === true || checked === false || checked === 'mixed') {
        node.checked = checked as boolean | 'mixed';
    }

    if (children.length > 0) node.children = children;

    return [node];
}

/**
 * Returns the page's accessibility tree, or null when it cannot be read.
 *
 * Replaces `page.accessibility.snapshot()`, which no longer exists in Playwright
 * 1.62 and above.
 */
export async function getAccessibilityTree(page: Page): Promise<AccessibilityNode | null> {
    let client: CDPSession;

    try {
        client = await page.context().newCDPSession(page);
    } catch {
        // Not chromium, or CDP unavailable.
        return null;
    }

    try {
        const { nodes } = (await client.send('Accessibility.getFullAXTree')) as { nodes: RawAXNode[] };
        if (!nodes?.length) return null;

        const byId = new Map(nodes.map(n => [n.nodeId, n]));
        // The root is the only node without a parent.
        const root = nodes.find(n => !n.parentId) ?? nodes[0];

        // Pruning can yield several top-level nodes if the root itself is
        // transparent; wrap them so callers always receive a single root.
        const built = buildNodes(root, byId);
        if (built.length === 1) return built[0];
        if (built.length === 0) return null;
        return { role: 'RootWebArea', name: '', children: built };
    } catch {
        return null;
    } finally {
        await client.detach().catch(() => { });
    }
}
