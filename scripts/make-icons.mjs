#!/usr/bin/env node
/**
 * Favicons, touch icon and web app manifest (design spec §6.3). The monogram is the dash: a signal-orange bar at
 * en-dash proportions (length:thickness ≈ 4.3:1) on ink, slightly below centre like the glyph. Not initials.
 *
 * Every size is drawn from the same proportions and snapped to whole pixels before rasterising, so the 16px icon
 * is as crisp as the 512px one (a downscaled 32-unit SVG would smear the bar across half pixels).
 *
 *   node scripts/make-icons.mjs        → public/favicon.svg, favicon.ico (16/32/48), favicon-192.png,
 *                                        favicon-512.png, apple-touch-icon.png (180), site.webmanifest
 * Commit the outputs; the build does not run this.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const INK = '#0B0B0C';
const SIGNAL = '#FF5A1F';
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

/** Bar geometry for a square icon of `size` px: 62.5% wide, centred; thickness 1/4.3 of the length; centre at 50.7%. */
export function bar(size) {
  const side = Math.round(size * 0.1875);
  const width = size - 2 * side;
  const height = Math.max(2, Math.round(width / 4.3));
  const y = Math.round(size * 0.507 - height / 2);
  return { x: side, y, width, height };
}

function svg(size) {
  const b = bar(size);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="${INK}"/>` +
    `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${SIGNAL}"/></svg>`
  );
}

/** Opaque PNG (no alpha: iOS and launchers fill transparency with their own colour). */
const png = (size) => sharp(Buffer.from(svg(size))).removeAlpha().png({ compressionLevel: 9 }).toBuffer();

/** ICO container with PNG-encoded entries (supported by every browser that still asks for /favicon.ico). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry); // width
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1); // height
    header.writeUInt8(0, entry + 2); // palette colours
    header.writeUInt8(0, entry + 3); // reserved
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

const manifest = {
  name: 'Roshan Dash',
  short_name: 'Roshan Dash',
  description: 'Software engineer in Singapore — backend systems, with AI agents in the loop.',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'minimal-ui',
  lang: 'en',
  background_color: INK,
  theme_color: INK,
  icons: [
    { src: '/favicon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/favicon-512.png', sizes: '512x512', type: 'image/png' },
    // The bar sits well inside the maskable safe zone (a centred circle of 80% diameter), so the same art works.
    { src: '/favicon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

writeFileSync(`${PUBLIC}favicon.svg`, `${svg(32)}\n`);
writeFileSync(`${PUBLIC}favicon.ico`, ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size) })))));
writeFileSync(`${PUBLIC}apple-touch-icon.png`, await png(180));
writeFileSync(`${PUBLIC}favicon-192.png`, await png(192));
writeFileSync(`${PUBLIC}favicon-512.png`, await png(512));
writeFileSync(`${PUBLIC}site.webmanifest`, `${JSON.stringify(manifest, null, 2)}\n`);
for (const size of [16, 32, 48, 180, 192, 512]) console.log(`${String(size).padStart(3)}px  bar`, bar(size));
