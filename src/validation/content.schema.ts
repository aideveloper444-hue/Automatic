import { z } from 'zod';

/**
 * Models sometimes return hashtags as a JSON array (e.g. ["#SaaS", "#AI"])
 * even when asked for a space-separated string. Accept either shape and
 * normalize to a single string.
 */
const hashtagsField = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).join(' ');
  }
  return value;
}, z.string());

export const GeneratedPostSchema = z.object({
  content: z.string().min(1, 'content must not be empty'),
  hashtags: hashtagsField.pipe(z.string().min(1, 'hashtags must not be empty')),
  imagePrompt: z.string().min(1, 'imagePrompt must not be empty'),
});

export type GeneratedPostJson = z.infer<typeof GeneratedPostSchema>;

export const TwitterVariantSchema = z.object({
  content: z.string().min(1, 'content must not be empty'),
  hashtags: hashtagsField.pipe(z.string()).default(''),
});

export type TwitterVariantJson = z.infer<typeof TwitterVariantSchema>;

export const InstagramVariantSchema = z.object({
  caption: z.string().min(1, 'caption must not be empty'),
  hashtags: hashtagsField.pipe(z.string().min(1, 'hashtags must not be empty')),
});

export type InstagramVariantJson = z.infer<typeof InstagramVariantSchema>;
