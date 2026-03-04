#!/usr/bin/env node
/**
 * Convert SVG to PNG using Playwright's browser engine.
 * Produces pixel-perfect output with proper transparency handling.
 *
 * Usage: node scripts/svg-to-png.mjs <input.svg> <output.png> [size]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const [,, svgPath, outPath, sizeArg] = process.argv;
if (!svgPath || !outPath) {
  console.error('Usage: node scripts/svg-to-png.mjs <input.svg> <output.png> [size]');
  process.exit(1);
}

const size = parseInt(sizeArg || '1024');
const svgContent = readFileSync(resolve(svgPath), 'utf-8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: size, height: size });

// Render SVG in a page with no margins/padding
await page.setContent(`
  <html>
    <body style="margin:0;padding:0;overflow:hidden;background:transparent">
      ${svgContent}
    </body>
  </html>
`);

// Screenshot the SVG element directly
const svg = await page.$('svg');
await svg.screenshot({ path: resolve(outPath), omitBackground: true });
await browser.close();
console.log(`Rendered ${svgPath} → ${outPath} (${size}x${size})`);
