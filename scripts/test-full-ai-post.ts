import fs from 'node:fs';
import axios from 'axios';
import { z } from 'zod';
import { env } from '../src/config/env.js';
import { BRAND } from '../src/config/brand.js';
import { appLogger } from '../src/config/logger.js';

const OUT_DIR = process.argv[2];
if (!OUT_DIR) {
  throw new Error('usage: tsx scripts/test-full-ai-post.ts <outDir>');
}

const OpenAiImageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().optional() })).min(1),
});

const prompt = `Design a polished, modern social media infographic poster for a tech brand called "${BRAND.name}", portrait orientation, clean corporate style, light background (off-white/light gray) with a dark navy-blue diagonal panel on the right side.

Layout, top to bottom:
- Top-left: a small rounded "DID YOU KNOW?" badge (dark navy background, white text, small lightbulb icon).
- Top-center: the "${BRAND.name}" wordmark in bold black/blue letters with a small triangular "A" logomark above it (navy triangle outline with a blue filled triangle inside).
- Top-right, on the dark panel: small handwritten-style italic caption "From a simple idea to a world of possibilities."
- Large bold headline below the badge, big black/blue text: "THE FIRST WEBSITE IS STILL ONLINE!" with "WEBSITE" in bright blue.
- Body paragraph below headline: "The world's first website was created by Tim Berners-Lee on August 6, 1991. It's still accessible at:" with "Tim Berners-Lee" and "August 6, 1991" in blue.
- A rounded blue pill button with a globe icon reading "http://info.cern.ch"
- Small line below with a calendar icon: "Over 30 years later, it's a reminder of how powerful a simple idea can be."
- On the dark navy right panel: a realistic illustration of a retro desktop computer monitor and keyboard displaying an old-style browser window (like early Mosaic/NCSA browser) with a simple page titled "World Wide Web", plus a glowing blue wireframe globe with network connection dots behind it.
- Small rounded dark badge at bottom of the navy panel with a globe icon: "INNOVATION STARTS WITH ONE STEP."

Middle section, light background, centered heading "WHAT WE LEARN FROM IT" with a horizontal line on each side, then a row of 5 circular blue-outlined icons with labels underneath: a rocket icon labeled "START SMALL" (subtext "Big things begin with simple ideas."), a share/network icon labeled "THINK GLOBAL" (subtext "Technology connects people everywhere."), a code icon labeled "KEEP IT SIMPLE" (subtext "Simplicity makes technology powerful."), a people icon labeled "SHARE & COLLABORATE" (subtext "The best innovations are built together."), a lightbulb icon labeled "CREATE IMPACT" (subtext "Technology should solve real problems.").

Below that, a wide dark navy rounded banner containing: on the left a glowing wireframe lightbulb-with-brain illustration, center a bold quote "EVERY GREAT INNOVATION STARTS WITH CURIOSITY." with "CURIOSITY" in blue, and smaller white text below "Keep learning. Keep building. Keep innovating.", then on the right three stat blocks each with a small circular icon: a calendar icon with "1991" and caption "The year the world wide web was born.", a globe icon with "30+" and caption "Years of connecting the world through information.", a people icon with an infinity symbol and caption "Countless opportunities the future holds."

Below the banner, a thin horizontal light section with a paper-plane icon, text "Great ideas change the world. What will you build next?" and a dark rounded button on the right reading "LET'S BUILD TOGETHER" with an arrow icon.

Bottom footer: a full-width dark navy bar with a globe icon and "VISIT OUR WEBSITE" / "${BRAND.website}", an envelope icon and "REACH OUT TO US" / "${BRAND.supportEmail}", and on the right "FOLLOW US" with small circular LinkedIn, Instagram, Facebook, and Twitter icons.

Overall style: professional B2B tech marketing graphic, crisp sans-serif typography, bright cyan-blue (#1c4bff style) accent color, generous whitespace, subtle dotted-grid decoration in the top-left corner, high production value, no watermark, no placeholder text, all text must be legible and spelled correctly.`;

async function main(): Promise<void> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  appLogger.info('test-full-ai-post: requesting full infographic image from OpenAI');

  const response = await axios.post(
    'https://api.openai.com/v1/images/generations',
    {
      model: env.OPENAI_IMAGE_MODEL,
      prompt,
      size: '1024x1536',
      quality: 'high',
      n: 1,
    },
    {
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    },
  );

  const validation = OpenAiImageResponseSchema.safeParse(response.data);
  const b64 = validation.success ? validation.data.data[0]?.b64_json : undefined;

  if (!b64) {
    throw new Error('Response did not include image data');
  }

  const buffer = Buffer.from(b64, 'base64');
  const outPath = `${OUT_DIR}/full-ai-post.png`;
  fs.writeFileSync(outPath, buffer);
  appLogger.info('test-full-ai-post: saved', { outPath, bytes: buffer.length });
}

void main();
