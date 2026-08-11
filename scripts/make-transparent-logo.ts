import sharp from 'sharp';

const SRC = 'e:/buffer/src/assets/brand-reference/logo.jpg';
const OUT = 'e:/buffer/src/assets/brand-reference/logo-transparent.png';

const image = sharp(SRC).ensureAlpha();
const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

const { width, height, channels } = info;
// A soft ramp sounds nicer in theory, but the JPEG source's flat "white"
// background isn't perfectly uniform (compression noise of a few values
// either side of 255), and ramping that noise into partial alpha turns the
// whole background into visible static. A hard cutoff close to pure white
// avoids that - it leaves a faint 1px fringe at the mark's anti-aliased
// edge, which is far less noticeable than background grain.
const threshold = 250;

for (let i = 0; i < data.length; i += channels) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  if (r >= threshold && g >= threshold && b >= threshold) {
    data[i + 3] = 0;
  }
}

await sharp(data, { raw: { width, height, channels } }).png().toFile(OUT);
console.log('wrote', OUT);
