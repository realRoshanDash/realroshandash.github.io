/**
 * Sätteri HAST plugin (design spec §4.17): wraps every Markdown table in a focusable, labelled scroll region,
 *   <div class="table-scroll" role="region" aria-label="Table" tabindex="0"><table>…</table></div>
 * so a wide table scrolls inside its own box on a phone (WCAG 1.4.10 reflow) and keyboard users can scroll it
 * (axe: scrollable-region-focusable). Runs for .md and .mdx alike (MDX inherits `markdown.processor`).
 * Regions need names that tell them apart: a post with several tables labels them "Table 1", "Table 2"…
 */
import { defineHastPlugin } from 'satteri';

const WRAPPER = 'table-scroll';
const COUNT = 'rdTableCount';
const SEEN = 'rdTablesSeen';

interface Node {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: readonly Node[];
}

const hasClass = (value: unknown, name: string): boolean =>
  (Array.isArray(value) ? value.map(String) : String(value ?? '').split(/\s+/)).includes(name);

/** Tables that will get a wrapper: every <table> not already inside one. */
function countTables(node: Node, wrapped = false): number {
  if (node.type === 'element' && node.tagName === 'table') return wrapped ? 0 : 1;
  const inside = wrapped || (node.type === 'element' && hasClass(node.properties?.className, WRAPPER));
  return (node.children ?? []).reduce((sum, child) => sum + countTables(child, inside), 0);
}

export const wrapTables = defineHastPlugin({
  name: 'wrap-tables',
  before(root, ctx) {
    ctx.data[COUNT] = countTables(root as unknown as Node);
    ctx.data[SEEN] = 0;
  },
  element: {
    filter: ['table'],
    visit(node, ctx) {
      // Never wrap twice (a table authored inside the wrapper, or a second pass over the tree)
      const parent = ctx.parent(node);
      if (parent?.type === 'element' && hasClass(parent.properties?.className, WRAPPER)) return;
      const n = Number(ctx.data[SEEN] ?? 0) + 1;
      ctx.data[SEEN] = n;
      const ariaLabel = Number(ctx.data[COUNT] ?? 1) > 1 ? `Table ${n}` : 'Table';
      ctx.wrapNode(node, {
        type: 'element',
        tagName: 'div',
        properties: { className: [WRAPPER], role: 'region', ariaLabel, tabIndex: 0 },
        children: [],
      });
    },
  },
});
