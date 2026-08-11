import sharp from 'sharp';

const SRC = 'e:/buffer/src/assets/brand-reference/logo-transparent.png';
const OUT = 'e:/buffer/src/assets/brand-reference/logo-white.png';

const image = sharp(SRC).ensureAlpha();
const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

for (let i = 0; i < data.length; i += channels) {
  if (data[i + 3] > 0) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
  }
}

await sharp(data, { raw: { width, height, channels } }).png().toFile(OUT);
console.log('wrote', OUT);
