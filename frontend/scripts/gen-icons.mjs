import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const svg = fs.readFileSync(path.resolve('public/favicon.svg'));
const outDir = path.resolve('public');

// Icons for PWA + Apple touch
const sizes = {
  'icon-192.png': 192,
  'icon-512.png': 512,
  'icon-maskable-512.png': 512,
  'apple-touch-icon.png': 180,
};

for (const [name, size] of Object.entries(sizes)) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const png = resvg.render().asPng();
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`wrote ${name} (${size}x${size})`);
}
