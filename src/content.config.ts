import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Writing. One folder per post keeps images next to the text:
 *   src/content/blog/<slug>/index.md   (or .mdx)
 *   src/content/blog/<slug>/cover.jpg
 * A single file (src/content/blog/<slug>.md) works too.
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/blog' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(1).max(140),
      description: z.string().min(1).max(300),
      published: z.coerce.date(),
      updated: z.coerce.date().optional(),
      tags: z.array(z.string().min(1)).default([]),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      featured: z.boolean().default(false),
      draft: z.boolean().default(false),
    }),
});

export const TRADE_STATUSES = ['watching', 'active', 'closed', 'stopped', 'invalidated'] as const;
export const TRADE_DIRECTIONS = ['long', 'short'] as const;
export const TRADE_TIMEFRAMES = ['intraday', 'swing', 'position'] as const;

/**
 * Trade ideas. Prices are per-share in the instrument's quote currency.
 * Lifecycle: watching → active → closed | stopped (or invalidated if it never triggered).
 */
const trades = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/trades' }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string().min(1).max(140),
        summary: z.string().min(1).max(300),
        ticker: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9.\-^=!]{1,15}$/, { error: 'Ticker must be 1–15 chars: letters, digits, . - ^ = !' }),
        exchange: z.string().trim().toUpperCase().default('NASDAQ'),
        /** TradingView symbol override, e.g. "NYSE:BRK.B" or "BINANCE:BTCUSDT". Defaults to EXCHANGE:TICKER. */
        tvSymbol: z.string().trim().optional(),
        direction: z.enum(TRADE_DIRECTIONS),
        setup: z.string().trim().min(1).max(60),
        timeframe: z.enum(TRADE_TIMEFRAMES).default('swing'),
        status: z.enum(TRADE_STATUSES).default('watching'),
        published: z.coerce.date(),
        updated: z.coerce.date().optional(),
        entry: z.number().positive(),
        stop: z.number().positive(),
        targets: z.array(z.number().positive()).min(1).max(5),
        /** Average exit price — required once the idea is closed or stopped. */
        exit: z.number().positive().optional(),
        closed: z.coerce.date().optional(),
        conviction: z.number().int().min(1).max(5).optional(),
        tags: z.array(z.string().min(1)).default([]),
        chart: image().optional(),
        chartAlt: z.string().optional(),
        updates: z
          .array(z.object({ date: z.coerce.date(), note: z.string().min(1) }))
          .default([]),
        draft: z.boolean().default(false),
      })
      .superRefine((t, ctx) => {
        const long = t.direction === 'long';
        if (long ? !(t.stop < t.entry) : !(t.stop > t.entry)) {
          ctx.addIssue({
            code: 'custom',
            path: ['stop'],
            message: `For a ${t.direction} idea the stop must be ${long ? 'below' : 'above'} the entry.`,
          });
        }
        t.targets.forEach((target, i) => {
          if (long ? !(target > t.entry) : !(target < t.entry)) {
            ctx.addIssue({
              code: 'custom',
              path: ['targets', i],
              message: `For a ${t.direction} idea every target must be ${long ? 'above' : 'below'} the entry.`,
            });
          }
        });
        if ((t.status === 'closed' || t.status === 'stopped') && t.exit === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['exit'],
            message: `A ${t.status} idea needs an exit price so its result can be computed.`,
          });
        }
      }),
});

/**
 * Notes — short-form: market notes, TILs, links, a photo with a caption. Title optional.
 *   src/content/notes/<yyyy-mm-dd-slug>.md  (or a folder with index.md + images)
 */
const notes = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/notes' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(140).optional(),
      published: z.coerce.date(),
      tags: z.array(z.string().min(1)).default([]),
      image: image().optional(),
      imageAlt: z.string().optional(),
      /** Optional external link the note is about. */
      link: z.url().optional(),
      draft: z.boolean().default(false),
    }),
});

export const collections = { blog, trades, notes };
