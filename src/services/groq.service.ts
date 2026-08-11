import axios from 'axios';
import { z } from 'zod';
import { env } from '../config/env.js';
import { appLogger } from '../config/logger.js';
import { calculateTextSimilarity } from '../utils/similarity.js';
import { GroqServiceError } from '../utils/errors.js';
import { BRAND } from '../config/brand.js';
import { InstagramVariantSchema, ThemedPostSchema, TwitterVariantSchema } from '../validation/content.schema.js';
import type { ContentTheme } from '../config/content-themes.js';
import type { PostRepository } from '../repositories/post.repository.js';
import type { InstagramVariantPayload, ThemedPostPayload, TwitterVariantPayload } from './gemini.service.js';

const MAX_GENERATION_ATTEMPTS = 3;
const TWITTER_MAX_GENERATION_ATTEMPTS = 5;
const TWITTER_CHAR_LIMIT = 280;
const REQUIRED_HASHTAG_COUNT = 4;
/**
 * Jaccard word-overlap similarity trips much more easily on short text than
 * on a full caption - two genuinely different ~30-word tweets about the same
 * theme will often share half their words (brand name, theme keywords,
 * connective words). 0.7 is right for the 80-150 word themed caption but was
 * causing Twitter to get skipped almost every run; 0.85 keeps real
 * near-duplicates out without flagging distinct tweets.
 */
const TWITTER_SIMILARITY_THRESHOLD = 0.85;

const GroqResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().optional() }).optional(),
      }),
    )
    .min(1),
});

function countHashtags(hashtags: string): number {
  return hashtags
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.startsWith('#')).length;
}

/**
 * Drop-in text-generation alternative to GeminiService (same
 * ThemedPostPayload/TwitterVariantPayload shapes, same validation/dedup
 * rules) after Gemini's free-tier daily quota (20 requests/day) proved too
 * small for this pipeline's cadence. Groq's free tier is far more generous
 * and its API is OpenAI-compatible chat completions.
 */
export class GroqService {
  constructor(private readonly postRepository: PostRepository) {}

  private buildThemedPrompt(theme: ContentTheme): string {
    return `You are the social media content director for ${BRAND.name}, a ${BRAND.tagline} (${BRAND.website}).

Write ONE Instagram/LinkedIn post for the content theme "${theme.label}".

Theme instructions: ${theme.guidance}

Content rules:
- This must read as genuinely educational/engaging content, not an advertisement - UNLESS the theme is
  specifically "Alphazox Brand Story", which is the only theme allowed to be promotional.
- Never invent or approximate statistics, customer counts, revenue, awards, certifications, or
  partnerships. If you're not certain a specific number is accurate, do not include a number at all.
- Do not give harmful, exploit, or attack-execution instructions under any theme.
- Keep it concrete and specific - avoid generic filler like "unlock possibilities" or "drive growth."

Output JSON only with keys: headline, subheadline, caption, hashtags.
- "headline": an array of 1 to 3 very short punchy lines (each under 6 words) that work as large
  display text on an image - this is the single main idea of the post, not a sentence.
- "subheadline": one short supporting sentence (under 18 words) that adds context under the headline.
- "caption": the full social caption, 80-150 words, engaging, ends with a soft call to action. Only
  include "reach out to us at ${BRAND.supportEmail}" as the CTA if the theme is "Alphazox Brand Story" -
  for all other themes end with something that invites discussion or reflection instead.
- "hashtags": a single space-separated string of EXACTLY ${REQUIRED_HASHTAG_COUNT} relevant hashtags,
  NOT a JSON array.`;
  }

  async generateThemedPost(theme: ContentTheme): Promise<ThemedPostPayload> {
    const prompt = this.buildThemedPrompt(theme);

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const rawText = await this.callGroqApi(prompt, `Themed(${theme.id})`, attempt);

      if (rawText === null) {
        continue;
      }

      const validation = ThemedPostSchema.safeParse(this.safeParseJson(rawText));

      if (!validation.success) {
        appLogger.warn('Groq response failed schema validation for themed post', {
          theme: theme.id,
          attempt,
          issues: validation.error.issues.map((issue) => issue.message),
        });
        continue;
      }

      const { headline, subheadline, caption, hashtags } = validation.data;

      if (countHashtags(hashtags) !== REQUIRED_HASHTAG_COUNT) {
        appLogger.warn('Themed post did not have exactly the required hashtag count', {
          theme: theme.id,
          attempt,
          count: countHashtags(hashtags),
        });
        continue;
      }

      if (await this.isDuplicateAgainstRecent(caption, 'linkedin')) {
        appLogger.info(`Duplicate detected for themed post (${theme.id}); regenerating content`, { attempt });
        continue;
      }

      return { headline, subheadline, caption, hashtags };
    }

    throw new GroqServiceError(`Unable to generate a unique themed post (${theme.id}) after retries`);
  }

  /**
   * Instagram used to reuse the LinkedIn caption verbatim - same words posted
   * to two platforms every hour. This rewrites it into its own caption (like
   * generateTwitterVariant does for Twitter) so all three platforms carry
   * distinct wording.
   */
  async generateInstagramVariant(
    topic: string,
    sourceContent: string,
    fallbackCaption: string,
    fallbackHashtags: string,
  ): Promise<InstagramVariantPayload> {
    const prompt = `Rewrite the following idea as a fresh Instagram caption, for
${BRAND.name} (${BRAND.tagline}).
Idea/topic: ${topic}
Source post (for context only, rewrite in your own words, do not copy sentences from it):
"""
${sourceContent}
"""
Requirements:
- 100-150 words, engaging, tasteful use of emojis, ends with something that invites discussion or
  reflection (a question or prompt) - not a hard sales pitch.
- Punchy, original phrasing - genuinely different wording and structure from the source post, not a
  light edit of it.
- Output JSON only with keys: caption, hashtags.
- "hashtags" MUST be a single space-separated string of EXACTLY ${REQUIRED_HASHTAG_COUNT} relevant
  hashtags, NOT a JSON array.`;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const rawText = await this.callGroqApi(prompt, 'Instagram', attempt);

      if (rawText === null) {
        continue;
      }

      const validation = InstagramVariantSchema.safeParse(this.safeParseJson(rawText));

      if (!validation.success) {
        appLogger.warn('Groq response failed schema validation for Instagram variant', {
          attempt,
          issues: validation.error.issues.map((issue) => issue.message),
        });
        continue;
      }

      const { caption, hashtags } = validation.data;

      if (countHashtags(hashtags) !== REQUIRED_HASHTAG_COUNT) {
        appLogger.warn('Instagram variant did not have exactly the required hashtag count', {
          attempt,
          count: countHashtags(hashtags),
        });
        continue;
      }

      if (
        (await this.isDuplicateAgainstRecent(caption, 'instagram')) ||
        calculateTextSimilarity(caption, sourceContent) >= 0.7
      ) {
        appLogger.info('Duplicate detected for Instagram variant; regenerating content', { attempt });
        continue;
      }

      return { caption, hashtags };
    }

    appLogger.warn(
      'Unable to generate a unique Instagram caption after retries; falling back to the LinkedIn caption',
    );
    return { caption: fallbackCaption, hashtags: fallbackHashtags };
  }

  async generateTwitterVariant(
    topic: string,
    sourceContent: string,
    fallbackHashtags?: string,
  ): Promise<TwitterVariantPayload> {
    const prompt = `Rewrite the following idea as a single, punchy tweet for X/Twitter, for
${BRAND.name} (${BRAND.tagline}).
Idea/topic: ${topic}
Source post (for context only, do not copy verbatim):
"""
${sourceContent}
"""
Requirements:
- The tweet text plus hashtags together must be under ${TWITTER_CHAR_LIMIT} characters TOTAL.
- Punchy, original phrasing - do not copy sentences from the source post.
- Output JSON only with keys: content, hashtags.
- "hashtags" MUST be a single space-separated string of EXACTLY ${REQUIRED_HASHTAG_COUNT}
  hashtags, NOT a JSON array.`;

    for (let attempt = 1; attempt <= TWITTER_MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const rawText = await this.callGroqApi(prompt, 'Twitter', attempt, TWITTER_MAX_GENERATION_ATTEMPTS);

      if (rawText === null) {
        continue;
      }

      const validation = TwitterVariantSchema.safeParse(this.safeParseJson(rawText));

      if (!validation.success) {
        appLogger.warn('Groq response failed schema validation for Twitter variant', {
          attempt,
          issues: validation.error.issues.map((issue) => issue.message),
        });
        continue;
      }

      const { content, hashtags } = validation.data;
      const combinedLength = `${content} ${hashtags}`.trim().length;

      if (combinedLength > TWITTER_CHAR_LIMIT) {
        appLogger.warn('Twitter variant exceeded character limit; regenerating', { attempt, combinedLength });
        continue;
      }

      if (countHashtags(hashtags) !== REQUIRED_HASHTAG_COUNT) {
        appLogger.warn('Twitter variant did not have exactly the required hashtag count', {
          attempt,
          count: countHashtags(hashtags),
        });
        continue;
      }

      if (await this.isDuplicateAgainstRecent(content, 'twitter', TWITTER_SIMILARITY_THRESHOLD)) {
        appLogger.info('Duplicate detected for Twitter variant; regenerating content', { attempt });
        continue;
      }

      return { content, hashtags };
    }

    appLogger.warn(
      'Unable to generate a unique Twitter post after retries; falling back to a truncated version of the source content so the slot is not skipped',
    );
    return this.buildFallbackTwitterVariant(sourceContent, fallbackHashtags);
  }

  /**
   * Last resort so a stubborn duplicate/validation loop never costs Twitter
   * its slot for the hour - reuses the already-approved themed caption
   * (trimmed to fit) instead of throwing and skipping the platform.
   */
  private buildFallbackTwitterVariant(sourceContent: string, fallbackHashtags?: string): TwitterVariantPayload {
    const hashtags = fallbackHashtags ?? '';
    const budget = hashtags ? TWITTER_CHAR_LIMIT - hashtags.length - 1 : TWITTER_CHAR_LIMIT;
    const trimmed =
      sourceContent.length > budget ? `${sourceContent.slice(0, Math.max(0, budget - 1)).trim()}…` : sourceContent;

    return { content: trimmed, hashtags };
  }

  private async callGroqApi(
    prompt: string,
    label: string,
    attempt: number,
    maxAttempts: number = MAX_GENERATION_ATTEMPTS,
  ): Promise<string | null> {
    appLogger.info('Calling Groq chat completions API', { label, attempt, model: env.GROQ_MODEL });

    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: env.GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            Authorization: `Bearer ${env.GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        },
      );

      const validation = GroqResponseSchema.safeParse(response.data);

      if (!validation.success) {
        appLogger.warn('Groq response envelope failed schema validation', { label, attempt });
        return null;
      }

      return validation.data.choices[0]?.message?.content ?? '';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appLogger.error('Groq API call failed', { label, attempt, error: message });

      if (attempt === maxAttempts) {
        throw new GroqServiceError(message);
      }

      return null;
    }
  }

  private async isDuplicateAgainstRecent(text: string, platform: string, threshold = 0.7): Promise<boolean> {
    const recentPosts = await this.postRepository.findRecentPostsByPlatform(platform, 20);
    return recentPosts.some(
      (post) => calculateTextSimilarity(post.content, text) >= threshold,
    );
  }

  private safeParseJson(raw: string): Record<string, unknown> | null {
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}
