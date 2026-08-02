import axios from 'axios';
import { env } from '../config/env.js';
import { appLogger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';
import { retryWithBackoff } from '../utils/retry.js';

export class PollinationsServiceError extends AppError {
  constructor(message: string) {
    super(`Pollinations service error: ${message}`, 502);
  }
}

/**
 * Free, keyless image generation (image.pollinations.ai/prompt/<prompt>).
 * A fixed seed per call still gives prompt-relevant variety day to day since
 * the prompt itself changes; we pass Date.now() as the seed so repeated
 * prompts (unlikely, given upstream dedupe) don't return a cached image.
 */
export class PollinationsService {
  async generateImage(prompt: string): Promise<Buffer> {
    return retryWithBackoff(
      async (attempt) => {
        appLogger.info('Requesting image from Pollinations AI', { attempt });

        const encodedPrompt = encodeURIComponent(prompt);
        const seed = Date.now() % 1_000_000;
        const url = `https://image.pollinations.ai/prompt/${encodedPrompt}`;

        const response = await axios.get<ArrayBuffer>(url, {
          params: {
            width: 1024,
            height: 1024,
            nologo: true,
            model: env.POLLINATIONS_MODEL,
            seed,
          },
          responseType: 'arraybuffer',
          timeout: 60000,
        });

        const contentType = String(response.headers['content-type'] ?? '');
        if (!contentType.startsWith('image/')) {
          throw new PollinationsServiceError(`Unexpected content-type: ${contentType}`);
        }

        const buffer = Buffer.from(response.data);
        appLogger.info('Received image from Pollinations AI', { bytes: buffer.length });
        return buffer;
      },
      { retries: 3, delayMs: 1000, label: 'Pollinations generateImage' },
    );
  }
}
