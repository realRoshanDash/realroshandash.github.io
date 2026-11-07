/**
 * Open Graph cards, 1200×630 (design spec §6.4): a satori tree → SVG (text as paths) → PNG with sharp. Build time
 * only; nothing here ships to the browser. Plain Node (no Astro imports), so it also runs from a script.
 *
 * Three layouts, one system (the dark colour set, the visible 12-column grid, the label row and rule, the dash):
 *  - site: the name, the dash crossing behind the portrait plate (the hero's sandwich), the role. Home + fallback.
 *  - page: a page title the dash runs out of, a two-line statement and the author line. About, Contact, Writing, tags.
 *  - post: eyebrow with number, time and date; the title (≤ 3 lines); a short dash; the author line; tag chips.
 *
 * Static Inter (the opsz-14 cut) from @fontsource/inter as WOFF: satori reads neither WOFF2 nor variable fonts.
 * The metrics below were measured on that file (spec §6.4).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import satori from 'satori';
import sharp from 'sharp';
import { SITE } from '../data/site.ts';
import { opticalLsb } from './optical.ts';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export type OgCard =
  | { kind: 'site' }
  | {
      kind: 'page';
      /** Site-relative path shown in the eyebrow, e.g. "/about". */
      route: string;
      /** Right-hand eyebrow label, e.g. "About" or "Tag · 3 posts". */
      eyebrow: string;
      title: string;
      /** The statement: one bold line (wraps to two at most) and an optional quieter line. */
      lead: string;
      sub?: string;
      /** Second line of the author block. */
      role?: string;
    }
  | {
      kind: 'post';
      title: string;
      /** "No. 004": position by publish date, oldest = 1. */
      no: number;
      minutes: number;
      /** ISO date, YYYY-MM-DD. */
      date: string;
      tags: readonly string[];
      draft?: boolean;
    };

/* ---------------------------------------------------------------- tokens (the dark set, in px) */
const C = {
  bg: '#0B0B0C',
  fg: '#F2F1EC',
  fg2: '#A9A8A2',
  fg3: '#8B8A84',
  rule: 'rgba(242,241,236,0.13)',
  rule2: 'rgba(242,241,236,0.30)',
  grid: 'rgba(242,241,236,0.05)',
  edge: 'rgba(242,241,236,0.16)',
  signal: '#FF5A1F',
} as const;
const M = 56; // outer margin
const RIGHT = OG_WIDTH - M; // 1144
const SANS = 'Inter';
const MONO = 'JetBrains Mono';
/** Static Inter, measured: en-dash centre and thickness, ascent and descent (em). */
const DASH_CENTRE = 0.2993;
const DASH_THICK = 0.1172;
const ASCENT = 0.96875;
const DESCENT = 0.2421875;
const CAP = 0.7275;
/**
 * Optical margin alignment: shift display text left by its first glyph's side bearing so the ink sits on the
 * margin. optical.ts holds the opsz-32 bearings; the static opsz-14 cut's are 1.22× wider ("R": .0659 vs .054).
 */
const lsb = (text: string, size: number) => Math.round(opticalLsb(text) * (0.0659 / 0.054) * size);

/* ---------------------------------------------------------------- assets (read once per build) */
const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
const fontFile = (id: string) => readFileSync(require.resolve(id));

type FontWeight = 400 | 500 | 600 | 700;
let fontCache: { name: string; data: Buffer; weight: FontWeight; style: 'normal' }[] | undefined;
function fonts() {
  fontCache ??= [
    ...([400, 500, 600, 700] as const).map((weight) => ({
      name: SANS,
      data: fontFile(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`),
      weight,
      style: 'normal' as const,
    })),
    { name: MONO, data: fontFile('@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'), weight: 400, style: 'normal' },
  ];
  return fontCache;
}

const images = new Map<string, Promise<string>>();
/** A src/assets image resized with sharp, as a data URI (satori embeds it in the SVG). */
function asset(file: string, width: number, height: number, format: 'jpeg' | 'png'): Promise<string> {
  const key = `${file}@${width}x${height}`;
  let uri = images.get(key);
  if (!uri) {
    uri = (async () => {
      const pipeline = sharp(join(root, 'src/assets', file)).resize(width, height, { fit: 'cover', position: 'top' });
      const data = await (format === 'png' ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 88 })).toBuffer();
      return `data:image/${format};base64,${data.toString('base64')}`;
    })();
    images.set(key, uri);
  }
  return uri;
}

/* ---------------------------------------------------------------- a tiny element builder for satori */
type Style = Record<string, string | number>;
interface El {
  type: string;
  props: { style?: Style; children?: El | string | (El | string)[]; src?: string; width?: number; height?: number };
}
const el = (style: Style, ...children: (El | string | false | undefined)[]): El => {
  const kids = children.filter((child): child is El | string => Boolean(child));
  return { type: 'div', props: { style, children: kids.length === 1 ? kids[0] : kids } };
};
const img = (src: string, style: Style & { width: number; height: number }): El => ({
  type: 'img',
  props: { src, width: style.width, height: style.height, style },
});
const abs = (left: number, top: number, style: Style = {}): Style => ({ position: 'absolute', left, top, display: 'flex', ...style });

const label = (size = 18): Style => ({
  fontFamily: SANS, fontSize: size, fontWeight: 500, letterSpacing: size * 0.08, color: C.fg3, lineHeight: 1,
});

/** The visible grid: 13 hairlines on twelve columns between the margins. */
const gridLines = (): El[] =>
  Array.from({ length: 13 }, (_, i) =>
    el(abs(Math.round(M + (i * (RIGHT - M)) / 12), 0, { width: 1, height: OG_HEIGHT, backgroundColor: C.grid })),
  );

/** Label row at y 56 and the rule at y 88. */
const eyebrow = (left: El | string, right?: El | string): El[] => [
  el(abs(M, 56, { width: RIGHT - M, justifyContent: 'space-between', alignItems: 'flex-start' }),
    typeof left === 'string' ? el(label(), left.toUpperCase()) : left,
    right && (typeof right === 'string' ? el(label(), right.toUpperCase()) : right)),
  el(abs(M, 88, { width: RIGHT - M, height: 1, backgroundColor: C.rule })),
];

/** Avatar, name and role, y 518–574. */
async function author(role: string): Promise<El> {
  return el(abs(M, 518, { alignItems: 'center', gap: 16 }),
    el({ display: 'flex', position: 'relative', width: 56, height: 56 },
      img(await asset('avatar.jpg', 112, 112, 'jpeg'), { width: 56, height: 56 }),
      el(abs(0, 0, { width: 56, height: 56, border: `1px solid ${C.edge}` }))),
    el({ display: 'flex', flexDirection: 'column', gap: 6 },
      el({ fontFamily: SANS, fontSize: 24, fontWeight: 600, letterSpacing: -0.24, color: C.fg, lineHeight: 1 }, SITE.name),
      el({ fontFamily: SANS, fontSize: 20, fontWeight: 400, color: C.fg2, lineHeight: 1 }, role)));
}

/** Crop marks 8px outside each corner of a box, 16px arms (as on the hero plate). */
function cropMarks(x: number, y: number, w: number, h: number): El[] {
  const arm = 16;
  const gap = 8;
  const line = (left: number, top: number, width: number, height: number) =>
    el(abs(left, top, { width, height, backgroundColor: C.fg3 }));
  const out: El[] = [];
  for (const [cx, sx] of [[x - gap, -1], [x + w + gap - 1, 1]] as const) {
    for (const [cy, sy] of [[y - gap, -1], [y + h + gap - 1, 1]] as const) {
      out.push(line(sx < 0 ? cx - arm + 1 : cx, cy, arm, 1));
      out.push(line(cx, sy < 0 ? cy - arm + 1 : cy, 1, arm));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- text measurement (satori's own layout) */
async function textWidth(text: string, size: number, tracking: number, weight: FontWeight = 700): Promise<number> {
  let width = 0;
  await satori(
    el({ display: 'flex', alignItems: 'flex-start', width: 4000 },
      el({ display: 'flex', fontFamily: SANS, fontWeight: weight, fontSize: size, letterSpacing: size * tracking, whiteSpace: 'nowrap' }, text)) as never,
    {
      width: 4000,
      height: Math.ceil(size * 1.4),
      fonts: fonts(),
      onNodeDetected: (node) => {
        if (node.textContent === text) width = Math.max(width, node.width);
      },
    },
  );
  return width;
}

/* ---------------------------------------------------------------- layouts */
async function siteCard(): Promise<El[]> {
  const F = 168;
  const plate = { x: 895, y: 128, w: 249, h: 332 };
  // The name box starts 0.84em-line boxes at 118; the dash centre sits 0.2993em above the "Dash" baseline (≈ 340),
  // which is 64% down the plate: the shoulder line, as on the hero.
  const lineBox = 0.84 * F;
  const nameTop = 118;
  const baseline2 = nameTop + lineBox + (lineBox - (ASCENT + DESCENT) * F) / 2 + ASCENT * F;
  const dashH = Math.round(DASH_THICK * F);
  const dashTop = Math.round(baseline2 - DASH_CENTRE * F - dashH / 2);
  const name = (text: string, top: number) =>
    el(abs(M - lsb(text, F), top, {
      fontFamily: SANS, fontSize: F, fontWeight: 700, letterSpacing: -0.05 * F, lineHeight: 0.84, color: C.fg, whiteSpace: 'nowrap',
    }), text);
  return [
    ...eyebrow('roshandash.com', `Software engineer · ${SITE.location}`),
    name('Roshan', nameTop),
    name('Dash', nameTop + lineBox),
    // the sandwich: photo → dash → cut-out → frame edge
    img(await asset('portrait.jpg', plate.w, plate.h, 'jpeg'), { ...abs(plate.x, plate.y), width: plate.w, height: plate.h }),
    el(abs(448, dashTop, { width: OG_WIDTH - 448, height: dashH, backgroundColor: C.signal })),
    img(await asset('portrait-cutout.png', plate.w, plate.h, 'png'), { ...abs(plate.x, plate.y), width: plate.w, height: plate.h }),
    el(abs(plate.x, plate.y, { width: plate.w, height: plate.h, border: `1px solid ${C.edge}` })),
    ...cropMarks(plate.x, plate.y, plate.w, plate.h),
    // The site's caption adds ", Singapore"; at this size that would run past the plate (the role line says it).
    el(abs(plate.x, plate.y + plate.h + 16, label(14)), `FIG. 01 — ${SITE.name}`.toUpperCase()),
    el(abs(M, 512, { fontFamily: SANS, fontSize: 34, fontWeight: 700, letterSpacing: -0.68, lineHeight: 1, color: C.fg }),
      `Software engineer in ${SITE.location}.`),
    el(abs(M, 556, { fontFamily: SANS, fontSize: 26, fontWeight: 400, letterSpacing: -0.26, lineHeight: 1, color: C.fg2 }),
      'Backend systems, with AI agents in the loop.'),
  ];
}

async function pageCard(card: Extract<OgCard, { kind: 'page' }>): Promise<El[]> {
  // The title runs one line at the largest size that leaves the dash at least 120px of run-out.
  const tracking = -0.05;
  const room = OG_WIDTH - M - 120;
  const natural = await textWidth(card.title, 100, tracking);
  const F = Math.max(64, Math.min(168, Math.floor((100 * room) / Math.max(natural, 1))));
  const lineBox = 0.86 * F;
  const baseline = (lineBox - (ASCENT + DESCENT) * F) / 2 + ASCENT * F; // from the top of the line box
  const dashH = Math.max(8, Math.round(DASH_THICK * F));
  const dashTop = Math.round(baseline - DASH_CENTRE * F - dashH / 2);
  const top = 128 - Math.round(baseline - CAP * F); // cap line on y 128, like the plate on the site card
  // Descenders hang below a 0.86 line box; pad the (clipping) title box so they stay visible.
  const descender = Math.ceil(baseline + DESCENT * F - lineBox) + 2;
  // Callers keep the copy short (each line ≤ 2 rows; see og.ts). Never pair satori's balance with lineClamp: it
  // balances the clamped line count and squeezes the text into a narrow column.
  const statement = { fontFamily: SANS, fontSize: 34, fontWeight: 700, letterSpacing: -0.68, lineHeight: 1.18, color: C.fg };
  const quiet = { fontFamily: SANS, fontSize: 26, fontWeight: 400, letterSpacing: -0.26, lineHeight: 1.3, color: C.fg2 };
  return [
    ...eyebrow(
      el({ fontFamily: MONO, fontSize: 18, color: C.fg3, lineHeight: 1 }, `roshandash.com${card.route}`),
      card.eyebrow,
    ),
    el(abs(0, top, { width: OG_WIDTH, flexDirection: 'column' }),
      el({ display: 'flex', alignItems: 'flex-start' },
        el({
          display: 'block', marginLeft: M - lsb(card.title, F), paddingBottom: descender, fontFamily: SANS, fontSize: F,
          fontWeight: 700, letterSpacing: tracking * F, lineHeight: 0.86, color: C.fg, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: room,
        }, card.title),
        el({ flexGrow: 1, height: dashH, marginTop: dashTop, marginLeft: Math.round(0.14 * F), backgroundColor: C.signal })),
      el({ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 34, marginLeft: M, width: RIGHT - M },
        el({ display: 'block', textWrap: 'balance', ...statement }, card.lead),
        card.sub && el({ display: 'block', textWrap: 'balance', ...quiet }, card.sub))),
    await author(card.role ?? `Software engineer · ${SITE.location}`),
  ];
}

async function postCard(card: Extract<OgCard, { kind: 'post' }>): Promise<El[]> {
  const n = card.title.length;
  const size = n <= 32 ? 88 : n <= 60 ? 72 : 60;
  // Balance titles that fit in three lines; clamp longer ones with an ellipsis (never both, see pageCard).
  const width = 860;
  const fits = (await textWidth(card.title, size, -0.04)) <= width * 3 * 0.9;
  const left = ['Writing', `No. ${String(card.no).padStart(3, '0')}`, card.draft && 'Draft'].filter(Boolean).join(' · ');
  const chips = card.tags.slice(0, 3).map((tag) =>
    el({
      display: 'flex', alignItems: 'center', height: 36, padding: '0 12px', border: `1px solid ${C.rule2}`,
      fontFamily: SANS, fontSize: 16, fontWeight: 500, color: C.fg2, lineHeight: 1,
    }, tag));
  return [
    ...eyebrow(left, `${card.minutes} min · ${card.date}`),
    el(abs(M, 128, { flexDirection: 'column', width }),
      el({
        display: 'block', ...(fits ? { textWrap: 'balance' } : { lineClamp: 3 }), fontFamily: SANS, fontSize: size,
        fontWeight: 700, letterSpacing: -0.04 * size, lineHeight: 1, color: C.fg, marginLeft: -lsb(card.title, size),
      }, card.title),
      el({ width: 96, height: 12, marginTop: 36, backgroundColor: C.signal })),
    await author(`Software engineer · ${SITE.location}`),
    chips.length > 0 && el(abs(M, 518, { width: RIGHT - M, height: 56, justifyContent: 'flex-end', alignItems: 'center', gap: 8 }), ...chips),
  ].filter((node): node is El => Boolean(node));
}

/** Render one card to PNG bytes. */
export async function renderOgPng(card: OgCard): Promise<Buffer> {
  const layers = card.kind === 'site' ? await siteCard() : card.kind === 'page' ? await pageCard(card) : await postCard(card);
  // No overflow: hidden on the root: the SVG viewport clips anyway, and satori would mask every layer (slow to rasterise).
  const tree = el(
    { display: 'flex', position: 'relative', width: OG_WIDTH, height: OG_HEIGHT, backgroundColor: C.bg },
    ...gridLines(),
    ...layers,
  );
  const svg = await satori(tree as never, { width: OG_WIDTH, height: OG_HEIGHT, fonts: fonts() });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: false }).toBuffer();
}
