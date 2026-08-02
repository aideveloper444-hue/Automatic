import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1),
  // "gemini-flash-latest" is a Google-maintained alias that always resolves
  // to their current recommended fast model, so this stays valid even as
  // specific model versions (e.g. gemini-2.5-flash) get retired over time.
  GEMINI_MODEL: z.string().default('gemini-flash-latest'),
  BUFFER_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  PORT: z.coerce.number().default(3000),
  TIMEZONE: z.string().default('Asia/Kolkata'),
  // Free, keyless image generation (image.pollinations.ai). "flux" is
  // Pollinations' general-purpose default model.
  POLLINATIONS_MODEL: z.string().default('flux'),
  // Optional: without these, Instagram scheduling is skipped (LinkedIn and
  // Twitter still run) since Buffer requires a public image URL for
  // Instagram posts and has no upload endpoint of its own. Pollinations
  // images are re-uploaded to Cloudinary for a guaranteed-stable URL rather
  // than passed to Buffer directly.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const isCloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);
