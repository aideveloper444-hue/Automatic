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
  // Optional: without these, Instagram scheduling is skipped (LinkedIn and
  // Twitter still run) since Buffer requires a public image URL for
  // Instagram posts and has no upload endpoint of its own. The rendered post
  // card is uploaded to Cloudinary for a guaranteed-stable URL rather than
  // passed to Buffer directly.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  // Optional: without this, the branded card falls back to the static line
  // icon badge (see template.service.ts) instead of an AI-generated hero
  // image.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  // Optional: real stock photography fallback for hero art when OpenAI isn't
  // available (billing, quota). See services/pexels.service.ts.
  PEXELS_API_KEY: z.string().optional(),
  // Optional: text-generation alternative to Gemini (see services/groq.service.ts) -
  // Gemini's free tier caps at 20 requests/day, too small for this pipeline's cadence.
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  // Optional: deterministic news-search fallback (see news-research.service.ts)
  // if Groq's compound web search fails - a real news API rather than an LLM
  // deciding whether/how much to search, so it sidesteps that failure mode
  // entirely. Free tier at gnews.io comfortably covers this pipeline's cadence.
  GNEWS_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const isCloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);

export const isOpenAiConfigured = Boolean(env.OPENAI_API_KEY);
export const isPexelsConfigured = Boolean(env.PEXELS_API_KEY);
export const isGroqConfigured = Boolean(env.GROQ_API_KEY);
export const isGNewsConfigured = Boolean(env.GNEWS_API_KEY);
