import axios from 'axios';
import { z } from 'zod';
import { env } from '../config/env.js';
import { appLogger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';
import { retryWithBackoff } from '../utils/retry.js';

export class PexelsServiceError extends AppError {
  constructor(message: string) {
    super(`Pexels service error: ${message}`, 502);
  }
}

const PexelsSearchResponseSchema = z.object({
  photos: z.array(
    z.object({
      src: z.object({
        original: z.string(),
        large2x: z.string(),
        large: z.string(),
      }),
      photographer: z.string().optional(),
    }),
  ),
});

/**
 * Real stock photography as a free fallback hero-image source when OpenAI
 * isn't available (billing/quota) - see content-themes.ts for the curated
 * search keywords per theme. Pexels' license permits free commercial use
 * with no attribution required.
 */
export class PexelsService {
  async searchPhoto(keywords: string[], orientation: 'portrait' | 'landscape'): Promise<Buffer> {
    const query = keywords[Math.floor(Math.random() * keywords.length)]!;

    return retryWithBackoff(
      async (attempt) => {
        appLogger.info('Searching Pexels for hero photo', { attempt, query, orientation });

        const searchResponse = await axios.get('https://api.pexels.com/v1/search', {
          params: { query, orientation, per_page: 15 },
          headers: { Authorization: env.PEXELS_API_KEY },
          timeout: 20000,
        });

        const validation = PexelsSearchResponseSchema.safeParse(searchResponse.data);

        if (!validation.success || validation.data.photos.length === 0) {
          throw new PexelsServiceError(`No photos found for query "${query}"`);
        }

        const photo = validation.data.photos[Math.floor(Math.random() * validation.data.photos.length)]!;

        const imageResponse = await axios.get(photo.src.large2x, {
          responseType: 'arraybuffer',
          timeout: 30000,
        });

        const buffer = Buffer.from(imageResponse.data as ArrayBuffer);
        appLogger.info('Fetched Pexels photo', { query, photographer: photo.photographer, bytes: buffer.length });
        return buffer;
      },
      { retries: 3, delayMs: 1000, label: 'Pexels searchPhoto' },
    );
  }
}
