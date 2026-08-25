import { z } from 'zod';

/**
 * Same lenient hashtag normalization as content.schema.ts (models sometimes
 * return an array, or drop the leading "#") but without a fixed count - news
 * posts use per-platform ranges instead (see groq.service.ts).
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

export const NewsStorySchema = z.object({
  headline: z.string().min(1),
  category: z.string().min(1),
  sourceName: z.string().min(1),
  sourceUrl: z.string().min(1),
  isDeveloping: z.boolean(),
  isMarketStory: z.boolean(),
  summary: z.string().min(1),
});

export type NewsStory = z.infer<typeof NewsStorySchema>;

export const NewsPostBundleSchema = z.object({
  cardHeadline: z.array(z.string().min(1)).min(1).max(3),
  cardSubheadline: z.string().min(1),
  linkedin: z.object({
    content: z.string().min(1),
    hashtags: hashtagsField.pipe(z.string().min(1)),
  }),
  instagram: z.object({
    caption: z.string().min(1),
    hashtags: hashtagsField.pipe(z.string().min(1)),
  }),
  twitter: z.object({
    content: z.string().min(1),
    hashtags: hashtagsField.pipe(z.string()).default(''),
  }),
});

export type NewsPostBundle = z.infer<typeof NewsPostBundleSchema>;
