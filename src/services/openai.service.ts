import axios from 'axios';
import { z } from 'zod';
import { env } from '../config/env.js';
import { appLogger } from '../config/logger.js';
import { OpenAiServiceError } from '../utils/errors.js';
import { retryWithBackoff } from '../utils/retry.js';
import type { ServiceTopic } from '../config/brand.js';
import type { ContentTheme } from '../config/content-themes.js';

const OpenAiImageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().optional() })).min(1),
});

type ImageSize = '1024x1024' | '1024x1536' | '1536x1024';

function buildHeroImagePrompt(topic: ServiceTopic): string {
  return `A minimalist, premium 3D icon illustration representing "${topic.name}" (${topic.tagline}).
Dark navy background, glowing cyan-blue rim lighting, isometric tech / abstract style, centered
composition, no text, no logo, no watermark, high detail, studio lighting.`;
}

function buildSceneArtPrompt(topic: ServiceTopic): string {
  return `A real photographic scene (not an illustration, not a 3D render, not a cartoon) depicting
people and/or technology related to "${topic.name}" (${topic.tagline}) in a modern professional
business/tech setting.

Editorial photography style, cinematic lighting, shallow depth of field, high production value, shot
on a professional camera. Color-graded in cool dark navy-blue tones with a subtle cyan accent glow, so
it reads as premium corporate photography rather than a bright everyday photo.

Full-bleed, edge to edge, fills the entire frame. No text, no logo, no watermark, no UI overlays, no
graphic icon elements, no white space or borders.`;
}

function buildThemedSceneArtPrompt(theme: ContentTheme, headline: string[], subheadline: string): string {
  return `A real photographic scene (not a 3D render, not an isometric icon, not a cartoon, not an
abstract illustration) supporting a technology social media post.

Post idea: "${headline.join(' ')}" — ${subheadline}
Content theme: ${theme.label}

Visual direction: ${theme.visualHint}

Show real human beings genuinely interacting with technology — working at a desk, collaborating in a
room, looking at a screen, holding a device — shot like authentic editorial/documentary photography of
real people, not stock-photo posing. Blend in real physical tech objects (laptops, monitors, servers,
phones, whiteboards) and, where the concept calls for it, near-future AI interface elements (a subtle
holographic data overlay, a translucent AI assistant panel floating near a screen, augmented-reality
style annotations) integrated naturally into the photographed scene rather than replacing the humans
and physical objects with pure abstract graphics.

Style: cinematic editorial photography, shallow depth of field, realistic skin tones and lighting,
color-graded in cool dark navy-blue tones with a subtle cyan accent glow so it reads as premium
corporate photography. High production value, shot on a professional camera.

If the visual direction involves contrasting two concepts side by side, differentiate them ONLY through
the photographed scene, lighting, or composition — never through text labels naming them.

Full-bleed, edge to edge, fills the entire frame. ABSOLUTELY NO TEXT OF ANY KIND anywhere in the image
— no labels, no captions, no words, no letters, no numbers, not even single words or category names.
No logo, no watermark, no UI chrome, no white space or borders — this is pure supporting visual, not a
finished poster.`;
}

export class OpenAiService {
  private async requestImage(
    prompt: string,
    size: ImageSize,
    label: string,
  ): Promise<Buffer> {
    return retryWithBackoff(
      async (attempt) => {
        appLogger.info(`Requesting image from OpenAI (${label})`, { attempt, size });

        const response = await axios.post(
          'https://api.openai.com/v1/images/generations',
          {
            model: env.OPENAI_IMAGE_MODEL,
            prompt,
            size,
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
          throw new OpenAiServiceError('Response did not include image data');
        }

        const buffer = Buffer.from(b64, 'base64');
        appLogger.info(`Received image from OpenAI (${label})`, { bytes: buffer.length });
        return buffer;
      },
      { retries: 3, delayMs: 1000, label: `OpenAI ${label}` },
    );
  }

  /**
   * Generates one square hero image per topic (shared across the
   * LinkedIn/Twitter/Instagram cards for that slot, see scheduler.service.ts)
   * so a single daily slot only costs one OpenAI image call, not three.
   */
  async generateImage(topic: ServiceTopic): Promise<Buffer> {
    return this.requestImage(buildHeroImagePrompt(topic), '1024x1024', 'generateImage');
  }

  /**
   * Generates the illustrated hero-panel art for a service-topic house-style
   * post (see template.service.ts renderHouseStyleCard) as an opaque
   * dark-navy square/portrait image, dropped into a rounded-rect card by
   * Satori - same proven crop-into-badge technique as generateImage(), just
   * at a larger size. Solid background instead of a transparent cutout
   * because gpt-image-1's "transparent" background mode produces soft
   * partial alpha across the whole canvas rather than a hard-edged cutout,
   * which washes out badly once composited.
   */
  async generateSceneArt(topic: ServiceTopic, size: '1024x1024' | '1024x1536' = '1024x1024'): Promise<Buffer> {
    return this.requestImage(buildSceneArtPrompt(topic), size, 'generateSceneArt');
  }

  /**
   * Same hero-panel-art technique as generateSceneArt(), but driven by a
   * content theme + generated headline/subheadline instead of a fixed
   * ServiceTopic - used by the themed content pipeline (see
   * content-themes.ts / GeminiService.generateThemedPost).
   */
  async generateThemedSceneArt(
    theme: ContentTheme,
    headline: string[],
    subheadline: string,
    size: '1024x1024' | '1024x1536' = '1024x1024',
  ): Promise<Buffer> {
    return this.requestImage(
      buildThemedSceneArtPrompt(theme, headline, subheadline),
      size,
      'generateThemedSceneArt',
    );
  }
}
