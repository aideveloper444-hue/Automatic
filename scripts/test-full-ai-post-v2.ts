import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { env } from '../src/config/env.js';
import { BRAND, SERVICE_TOPICS } from '../src/config/brand.js';
import { appLogger } from '../src/config/logger.js';

const OUT_DIR = process.argv[2];
if (!OUT_DIR) {
  throw new Error('usage: tsx scripts/test-full-ai-post-v2.ts <outDir>');
}

const REF_DIR = path.join(process.cwd(), 'src', 'assets', 'brand-reference');

const OpenAiImageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().optional() })).min(1),
});

const topic = SERVICE_TOPICS.find((t) => t.name === 'Data Engineering')!;

const prompt = `Use the first reference image (the AlphaZox logo) EXACTLY as shown, unmodified, pixel-faithful, no redrawing or restyling of the wordmark or triangle mark.

Use the second reference image as the exact layout/style template. Recreate the same structure and design language, but replace the content with a NEW post about "${topic.name}":

- Top: the AlphaZox logo (from the first reference image) exactly as given.
- Light background top portion, dark navy diagonal panel on the right/bottom third (same blob-curve shape as the reference).
- Bold headline in the reference's type style: "${topic.tagline}" with the key phrase in bright blue, rest in dark navy/black.
- Short supporting paragraph: "${topic.name} done right: clean data, strong pipelines, and dashboards your team can trust."
- On the dark navy panel: a modern illustration themed around data engineering — glowing data pipeline flowing into a dashboard/database icon, holographic bar charts and streaming data particles, blue glow, dark city-tech backdrop, matching the reference's illustration style and lighting.
- A small rounded caption pill on the dark panel like the reference's caption pill.
- Middle light section: heading "WHAT WE DO" with a horizontal rule on each side, then a row of exactly 5 circular blue-outline icon items with bold labels underneath, one per capability: "${topic.capabilities.join('", "')}". Each gets a short one-line description matching the reference's caption style.
- A wide dark navy rounded banner below with a bold quote-style line and 2-3 small stat callouts, styled like the reference's dark banner section.
- A thin CTA row with a short prompt line and a rounded button.
- Footer: full-width dark navy bar with globe icon "VISIT OUR WEBSITE" / "${BRAND.website}", envelope icon "REACH OUT TO US" / "${BRAND.supportEmail}", and "FOLLOW US" with small circular LinkedIn, Instagram, Facebook, Twitter icons.

Professional B2B tech marketing graphic, crisp sans-serif typography, bright cyan-blue accent color matching the reference, generous whitespace, high production value, no watermark, all text spelled correctly and legible.`;

async function main(): Promise<void> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  appLogger.info('test-full-ai-post-v2: requesting logo-conditioned infographic from OpenAI', {
    topic: topic.name,
  });

  const logoBytes = fs.readFileSync(path.join(REF_DIR, 'logo.jpg'));
  const styleRefBytes = fs.readFileSync(
    path.join(REF_DIR, 'template-transforming-ideas.png'),
  );

  const form = new FormData();
  form.append('model', env.OPENAI_IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('size', '1024x1536');
  form.append('quality', 'high');
  form.append('n', '1');
  form.append('image[]', new Blob([logoBytes], { type: 'image/jpeg' }), 'logo.jpg');
  form.append(
    'image[]',
    new Blob([styleRefBytes], { type: 'image/png' }),
    'style-reference.png',
  );

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI images/edits failed: ${res.status} ${errBody}`);
  }

  const json = await res.json();
  const validation = OpenAiImageResponseSchema.safeParse(json);
  const b64 = validation.success ? validation.data.data[0]?.b64_json : undefined;

  if (!b64) {
    throw new Error('Response did not include image data');
  }

  const buffer = Buffer.from(b64, 'base64');
  const outPath = `${OUT_DIR}/full-ai-post-v2-data-engineering.png`;
  fs.writeFileSync(outPath, buffer);
  appLogger.info('test-full-ai-post-v2: saved', { outPath, bytes: buffer.length });
}

void main();
