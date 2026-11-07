#!/usr/bin/env node
/**
 * Raster icons from the monogram (design spec §6.3). The monogram is the dash: a horizontal signal bar at en-dash
 * proportions (about 4.3:1) on ink. Not initials. public/favicon.svg is the source of truth for the shape; this writes
 * the 180×180 Apple touch icon from the same geometry.
 *
 *   node scripts/make-icons.mjs
 */
import sharp from 'sharp';

const INK = '#0B0B0C';
const SIGNAL = '#FF5A1F';

const touchIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="${INK}"/>
  <rect x="34" y="78" width="112" height="26" fill="${SIGNAL}"/>
</svg>`;

await sharp(Buffer.from(touchIcon)).png({ compressionLevel: 9, palette: true }).toFile('public/apple-touch-icon.png');
console.log('wrote public/apple-touch-icon.png (180×180)');
