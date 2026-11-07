import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { OG_HEIGHT, OG_WIDTH, renderOgPng, type OgCard } from '../src/lib/og-render.ts';

// One of each layout: fonts resolve from @fontsource, the portrait assets load, satori lays out and sharp encodes.
const cards: Record<string, OgCard> = {
  site: { kind: 'site' },
  page: { kind: 'page', route: '/about', eyebrow: 'About', title: 'About', lead: 'Software engineer in Singapore.' },
  post: { kind: 'post', title: 'A title long enough to wrap onto a second line of the card', no: 4, minutes: 9, date: '2026-11-07', tags: ['java', 'databases'] },
  longPost: { kind: 'post', title: 'x '.repeat(70).trim(), no: 1, minutes: 1, date: '2026-11-07', tags: [] },
};

describe('Open Graph cards', () => {
  for (const [name, card] of Object.entries(cards)) {
    test(`${name} card renders a 1200×630 opaque PNG`, async () => {
      const png = await renderOgPng(card);
      const meta = await sharp(png).metadata();
      assert.equal(meta.format, 'png');
      assert.equal(meta.width, OG_WIDTH);
      assert.equal(meta.height, OG_HEIGHT);
      // the corner is the ink background, not transparent
      const { data } = await sharp(png).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual([...data.subarray(0, 3)], [0x0b, 0x0b, 0x0c]);
    });
  }
});
