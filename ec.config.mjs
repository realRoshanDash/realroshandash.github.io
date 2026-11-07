// @ts-check
/**
 * Expressive Code (design spec §4.17): code is a dark "mounted print" in BOTH site themes — one theme, no theme
 * switching — set on the theme-independent plate tokens (src/styles/tokens.css: --plate, --plate-fg, --plate-fg-3 …),
 * monochrome syntax plus one signal colour for annotations. Placement and the frame chrome that has to follow the
 * page tokens live in src/styles/prose.css.
 *
 * Options live here (not inline in astro.config.mjs) so that plugins work for Markdown, MDX and the <Code> component.
 * The colours are the plate token values; Expressive Code needs literals, as it derives contrast-checked variants.
 */
import { defineEcConfig, ExpressiveCodeTheme } from 'astro-expressive-code';
import { h } from 'astro-expressive-code/hast';

/** The plate (tokens.css :root plate block). */
const PLATE = {
  bg: '#141416',
  fg: '#F2F1EC',
  fg2: '#A9A8A2',
  fg3: '#9A9993', // comments, meta, gutters on the plate (6.44:1)
  base: '#C9C8C2', // code base text (10.97:1)
  string: '#D8CBA8', // 11.41:1
  number: '#E9E8E2', // 14.99:1
  punct: '#B0AFA9', // 8.37:1
  signal: '#FF5A1F',
  signalText: '#FF7040', // annotations (6.70:1)
  gain: '#7ADCC0',
  loss: '#D9506C',
  rule: 'rgb(242 241 236 / 0.14)',
  edge: 'rgb(242 241 236 / 0.16)',
};

/** "rd-ink", VS Code theme format. No bold or italic: only JetBrains Mono 400 ships. */
const rdInk = new ExpressiveCodeTheme({
  name: 'rd-ink',
  type: 'dark',
  colors: {
    'editor.background': PLATE.bg,
    'editor.foreground': PLATE.base,
    'editorLineNumber.foreground': PLATE.fg3,
    'editorLineNumber.activeForeground': PLATE.fg,
    'editor.selectionBackground': '#FF5A1F47',
    focusBorder: PLATE.signalText,
    'editorGroupHeader.tabsBackground': PLATE.bg,
    'tab.activeBackground': PLATE.bg,
    'tab.activeForeground': PLATE.fg,
    'titleBar.activeBackground': PLATE.bg,
    'titleBar.activeForeground': PLATE.fg2,
  },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment', 'comment.block.documentation'], settings: { foreground: PLATE.fg3 } },
    {
      scope: ['keyword', 'keyword.control', 'keyword.other', 'keyword.operator.new', 'storage', 'storage.type', 'storage.modifier',
        'variable.language', 'constant.language', 'support.type.primitive', 'entity.name.tag'],
      settings: { foreground: PLATE.fg },
    },
    {
      scope: ['entity.name.type', 'entity.name.class', 'support.class', 'entity.other.inherited-class', 'entity.name.function',
        'support.function', 'meta.function-call', 'entity.name.method'],
      settings: { foreground: PLATE.fg },
    },
    {
      scope: ['string', 'string.quoted', 'string.template', 'string.regexp', 'constant.character', 'constant.other.symbol', 'markup.inline.raw'],
      settings: { foreground: PLATE.string },
    },
    { scope: ['constant.numeric', 'constant.language.boolean', 'constant.language.null'], settings: { foreground: PLATE.number } },
    { scope: ['variable', 'variable.other', 'variable.parameter', 'support.variable', 'meta.definition.variable'], settings: { foreground: PLATE.base } },
    { scope: ['entity.other.attribute-name', 'support.type.property-name'], settings: { foreground: PLATE.fg2 } },
    { scope: ['punctuation', 'meta.brace', 'punctuation.separator', 'punctuation.terminator', 'keyword.operator'], settings: { foreground: PLATE.punct } },
    {
      scope: ['storage.type.annotation', 'punctuation.definition.annotation', 'meta.annotation', 'meta.decorator',
        'entity.name.function.decorator', 'punctuation.decorator'],
      settings: { foreground: PLATE.signalText },
    },
    { scope: ['markup.inserted'], settings: { foreground: PLATE.gain } },
    { scope: ['markup.deleted'], settings: { foreground: PLATE.loss } },
    { scope: ['markup.heading', 'markup.bold', 'markup.italic'], settings: { foreground: PLATE.fg, fontStyle: '' } },
  ],
});

/** Languages that read as a session or a patch, not a source file: no line numbers. */
const NO_LINE_NUMBERS = new Set(['bash', 'sh', 'shell', 'shellscript', 'zsh', 'console', 'shellsession', 'powershell', 'ps1',
  'txt', 'text', 'plaintext', 'ansi', 'diff', '']);

/**
 * Line numbers in the gutter (the hanging-number idea, at code scale), drawn from Expressive Code's own gutter API,
 * so no extra package is needed. On by default; off for shells, plain text and diffs. Override per block in the
 * meta string: ```ts showLineNumbers=false / ```sh showLineNumbers startLineNumber=40.
 * @returns {import('astro-expressive-code').ExpressiveCodePlugin}
 */
function pluginLineNumbers() {
  return {
    name: 'rd-line-numbers',
    hooks: {
      preprocessCode: ({ codeBlock, addGutterElement }) => {
        const show = codeBlock.metaOptions.getBoolean('showLineNumbers') ?? !NO_LINE_NUMBERS.has(codeBlock.language);
        if (!show) return;
        const start = codeBlock.metaOptions.getInteger('startLineNumber') ?? 1;
        // A fixed width per block, so every line's gutter is the same width
        const width = `${String(start + codeBlock.getLines().length - 1).length}ch`;
        addGutterElement({
          renderPhase: 'earlier',
          renderLine: ({ lineIndex }) => h('div.ln', { 'aria-hidden': 'true', style: `min-width:${width}` }, String(start + lineIndex)),
          renderPlaceholder: () => h('div.ln', { 'aria-hidden': 'true', style: `min-width:${width}` }),
        });
      },
    },
  };
}

/**
 * The language in the frame header, set in the label style (JAVA, SQL): what the block is, read before the code.
 * Terminal frames already say what they are.
 * @returns {import('astro-expressive-code').ExpressiveCodePlugin}
 */
function pluginLanguageLabel() {
  const NAMES = /** @type {Record<string, string>} */ ({
    ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX', js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX',
    mjs: 'JavaScript', java: 'Java', kotlin: 'Kotlin', kt: 'Kotlin', go: 'Go', rust: 'Rust', rs: 'Rust', py: 'Python',
    python: 'Python', sql: 'SQL', json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML', html: 'HTML',
    css: 'CSS', diff: 'Diff', md: 'Markdown', mdx: 'MDX', proto: 'Protobuf', graphql: 'GraphQL', dockerfile: 'Dockerfile',
    astro: 'Astro', c: 'C', cpp: 'C++', scala: 'Scala', groovy: 'Groovy', hcl: 'HCL', ini: 'INI', properties: 'Properties',
  });
  return {
    name: 'rd-language-label',
    hooks: {
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const label = NAMES[codeBlock.language];
        if (!label) return;
        /** @param {any} node @returns {any} */
        const find = (node) => {
          if (node?.type === 'element' && node.tagName === 'figcaption') return node;
          for (const child of node?.children ?? []) {
            const hit = find(child);
            if (hit) return hit;
          }
          return undefined;
        };
        const caption = find(renderData.blockAst);
        if (!caption) return;
        /** @type {any} */
        const frame = renderData.blockAst.children?.find((/** @type {any} */ c) => c.type === 'element' && c.tagName === 'figure');
        if (String(frame?.properties?.className ?? '').includes('is-terminal')) return;
        caption.children.push(h('span.lang', label));
      },
    },
  };
}

export default defineEcConfig({
  themes: [rdInk],
  // One theme for both site themes: no prefers-color-scheme or theme-selector variants
  useDarkModeMediaQuery: false,
  themeCssSelector: false,
  minSyntaxHighlightingColorContrast: 4.5,
  plugins: [pluginLineNumbers(), pluginLanguageLabel()],
  defaultProps: { wrap: false },
  styleOverrides: {
    borderRadius: '0',
    borderWidth: '1px',
    borderColor: PLATE.edge,
    codeFontFamily: 'var(--font-mono, ui-monospace, monospace)',
    codeFontSize: 'var(--fs-mono, 13.5px)',
    codeFontWeight: '400',
    codeLineHeight: '1.7',
    codePaddingBlock: '16px',
    codePaddingInline: '20px',
    codeBackground: PLATE.bg,
    codeForeground: PLATE.base,
    codeSelectionBackground: 'rgb(255 90 31 / 0.28)',
    uiFontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
    uiFontSize: '12.5px',
    uiFontWeight: '550',
    uiLineHeight: '1.4',
    uiPaddingBlock: '11px',
    uiPaddingInline: '16px',
    uiSelectionBackground: PLATE.signal,
    uiSelectionForeground: '#0B0B0C',
    gutterBorderColor: 'transparent',
    gutterBorderWidth: '0',
    gutterForeground: PLATE.fg3,
    gutterHighlightForeground: PLATE.fg,
    focusBorder: PLATE.signalText,
    scrollbarThumbColor: 'rgb(242 241 236 / 0.18)',
    scrollbarThumbHoverColor: 'rgb(242 241 236 / 0.32)',
    frames: {
      shadowColor: 'transparent',
      frameBoxShadowCssValue: 'none',
      editorBackground: PLATE.bg,
      editorTabBarBackground: PLATE.bg,
      editorTabBarBorderColor: PLATE.edge,
      editorTabBarBorderBottomColor: 'rgb(242 241 236 / 0.10)',
      editorTabBorderRadius: '0',
      editorTabsMarginInlineStart: '0',
      editorTabsMarginBlockStart: '0',
      editorActiveTabBackground: PLATE.bg,
      editorActiveTabForeground: PLATE.fg,
      editorActiveTabBorderColor: 'transparent',
      editorActiveTabIndicatorHeight: '2px',
      editorActiveTabIndicatorTopColor: 'transparent',
      editorActiveTabIndicatorBottomColor: PLATE.signal,
      terminalBackground: PLATE.bg,
      terminalTitlebarBackground: PLATE.bg,
      terminalTitlebarForeground: PLATE.fg2,
      terminalTitlebarBorderBottomColor: 'rgb(242 241 236 / 0.10)',
      terminalTitlebarDotsForeground: '#5E5D59',
      terminalTitlebarDotsOpacity: '1',
      inlineButtonBackground: PLATE.fg,
      inlineButtonForeground: PLATE.fg,
      inlineButtonBorder: 'rgb(242 241 236 / 0.30)',
      inlineButtonBorderOpacity: '1',
      inlineButtonBackgroundIdleOpacity: '0',
      inlineButtonBackgroundHoverOrFocusOpacity: '0.08',
      inlineButtonBackgroundActiveOpacity: '0.14',
      tooltipSuccessBackground: PLATE.signal,
      tooltipSuccessForeground: '#0B0B0C',
    },
    textMarkers: {
      lineMarkerAccentWidth: '3px',
      lineMarkerAccentMargin: '0',
      inlineMarkerBorderRadius: '0',
      inlineMarkerBorderWidth: '1px',
      markBackground: 'rgb(255 90 31 / 0.12)',
      markBorderColor: PLATE.signal,
      insBackground: 'rgb(122 220 192 / 0.10)',
      insBorderColor: PLATE.gain,
      insDiffIndicatorColor: PLATE.gain,
      delBackground: 'rgb(217 80 108 / 0.12)',
      delBorderColor: PLATE.loss,
      delDiffIndicatorColor: PLATE.loss,
    },
  },
});
