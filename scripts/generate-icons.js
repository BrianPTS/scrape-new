#!/usr/bin/env node
/**
 * Generate PWA PNG icons from the SVG icon.
 *
 * Usage: node scripts/generate-icons.js
 *
 * Requires: npm install sharp (dev dependency)
 * Or manually create 192x192 and 512x512 PNGs from public/icon.svg
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const svgPath = join(publicDir, 'icon.svg');

async function generate() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('sharp not installed. Run: npm install -D sharp');
    console.log('Then re-run: node scripts/generate-icons.js');
    process.exit(1);
  }

  const svgBuffer = readFileSync(svgPath);
  const sizes = [192, 512];

  for (const size of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(join(publicDir, `icon-${size}.png`));
    console.log(`Generated icon-${size}.png`);
  }

  // Maskable icon: add 10% padding for safe zone
  const maskableSize = 512;
  const innerSize = Math.round(maskableSize * 0.8);
  const padding = Math.round((maskableSize - innerSize) / 2);

  await sharp({
    create: {
      width: maskableSize,
      height: maskableSize,
      channels: 4,
      background: { r: 30, g: 27, b: 75, alpha: 1 }, // #1e1b4b
    },
  })
    .composite([
      {
        input: await sharp(svgBuffer).resize(innerSize, innerSize).png().toBuffer(),
        left: padding,
        top: padding,
      },
    ])
    .png()
    .toFile(join(publicDir, 'icon-maskable-512.png'));

  console.log('Generated icon-maskable-512.png');
  console.log('Done! All PWA icons generated.');
}

generate().catch(console.error);
