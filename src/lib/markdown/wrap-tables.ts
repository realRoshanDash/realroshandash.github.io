/**
 * Sätteri HAST plugin (design spec §4.17): wraps every Markdown table in a focusable, labelled scroll region,
 *   <div class="table-scroll" role="region" aria-label="Table" tabindex="0"><table>…</table></div>
 * so a wide table scrolls inside its own box on a phone (WCAG 1.4.10 reflow) and keyboard users can scroll it
 * (axe: scrollable-region-focusable). Runs for .md and .mdx alike (MDX inherits `markdown.processor`).
 */
import { defineHastPlugin } from 'satteri';

const WRAPPER = 'table-scroll';

const hasClass = (value: unknown, name: string): boolean =>
  (Array.isArray(value) ? value.map(String) : String(value ?? '').split(/\s+/)).includes(name);

export const wrapTables = defineHastPlugin({
  name: 'wrap-tables',
  element: {
    filter: ['table'],
    visit(node, ctx) {
      // Never wrap twice (a table authored inside the wrapper, or a second pass over the tree)
      const parent = ctx.parent(node);
      if (parent?.type === 'element' && hasClass(parent.properties?.className, WRAPPER)) return;
      ctx.wrapNode(node, {
        type: 'element',
        tagName: 'div',
        properties: { className: [WRAPPER], role: 'region', ariaLabel: 'Table', tabIndex: 0 },
        children: [],
      });
    },
  },
});
