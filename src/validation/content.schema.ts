import { z } from 'zod';

/**
 * Models sometimes return hashtags as a JSON array (e.g. ["#SaaS", "#AI"])
 * even when asked for a space-separated string, and some models (observed
 * with Llama 3.3 via Groq) drop the leading "#" entirely despite an example
 * in the prompt. Accept either shape and normalize to a "#"-prefixed,
 * space-separated string so the hashtag-count check doesn't depend on the
 * model getting the literal character right.
 */
const hashtagsField = z.preprocess((value) => {
  const tokens = Array.isArray(value)
    ? value.map((v) => String(v).trim())
    : String(value).trim().split(/\s+/);

  return tokens
    .filter((token) => token.length > 0)
    .map((token) => (token.startsWith('#') ? token : `#${token}`))
    .join(' ');
}, z.string());

export const GeneratedPostSchema = z.object({
  content: z.string().min(1, 'content must not be empty'),
  hashtags: hashtagsField.pipe(z.string().min(1, 'hashtags must not be empty')),
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

export const ThemedPostSchema = z.object({
  headline: z.array(z.string().min(1)).min(1).max(3),
  subheadline: z.string().min(1, 'subheadline must not be empty'),
  caption: z.string().min(1, 'caption must not be empty'),
  hashtags: hashtagsField.pipe(z.string().min(1, 'hashtags must not be empty')),
});

export type ThemedPostJson = z.infer<typeof ThemedPostSchema>;
