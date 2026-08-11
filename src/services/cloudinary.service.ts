import { createHash } from 'node:crypto';
import axios from 'axios';
import { env, isCloudinaryConfigured } from '../config/env.js';
import { appLogger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';
import { retryWithBackoff } from '../utils/retry.js';

export class CloudinaryUploadError extends AppError {
  constructor(message: string) {
    super(`Cloudinary upload error: ${message}`, 502);
  }
}

export class CloudinaryService {
  /**
   * Uploads an image buffer and returns a stable, publicly fetchable URL.
   * Uses Cloudinary's signed upload API directly (sha1 signature over the
   * params-to-sign + api secret) so no SDK dependency is needed - only
   * axios (already a dependency) and Node's built-in crypto module.
   */
  /**
   * `format` controls the delivered file type (independent of the source
   * buffer, which is always PNG from Resvg) - Cloudinary transcodes on
   * upload. Instagram callers should pass 'jpg': Buffer's Instagram publish
   * path is unreliable with PNG assets and has been observed to silently
   * drop the post (accepted at createPost, gone from the queue moments
   * later) rather than surface a clear error.
   */
  async uploadImage(
    imageBuffer: Buffer,
    publicIdHint: string,
    format: 'png' | 'jpg' = 'png',
  ): Promise<string> {
    if (!isCloudinaryConfigured) {
      throw new CloudinaryUploadError(
        'Cloudinary is not configured (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)',
      );
    }

    return retryWithBackoff(
      async (attempt) => {
        appLogger.info('Uploading image to Cloudinary', { attempt, publicIdHint, format });

        const timestamp = Math.floor(Date.now() / 1000);
        const publicId = `buffer-ai-content-automation/${publicIdHint}`;
        const paramsToSign = `format=${format}&public_id=${publicId}&timestamp=${timestamp}`;
        const signature = createHash('sha1')
          .update(`${paramsToSign}${env.CLOUDINARY_API_SECRET}`)
          .digest('hex');

        const dataUri = `data:image/png;base64,${imageBuffer.toString('base64')}`;

        const body = new URLSearchParams({
          file: dataUri,
          public_id: publicId,
          timestamp: String(timestamp),
          format,
          api_key: env.CLOUDINARY_API_KEY ?? '',
          signature,
        });

        const response = await axios.post<{ secure_url?: string }>(
          `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
          body,
          { timeout: 30000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        );

        const url = response.data.secure_url;

        if (!url) {
          throw new CloudinaryUploadError('Upload response did not include a secure_url');
        }

        appLogger.info('Uploaded image to Cloudinary', { url });
        return url;
      },
      { retries: 3, delayMs: 1000, label: 'Cloudinary uploadImage' },
    );
  }
}
