import axios from 'axios';
import { z } from 'zod';
import { env } from '../config/env.js';
import { appLogger } from '../config/logger.js';
import { calculateTextSimilarity } from '../utils/similarity.js';
import { GeminiServiceError } from '../utils/errors.js';
import { BRAND, ServiceTopic } from '../config/brand.js';
import {
  GeneratedPostSchema,
  InstagramVariantSchema,
  ThemedPostSchema,
  TwitterVariantSchema,
} from '../validation/content.schema.js';
import type { ContentTheme } from '../config/content-themes.js';
import type { PostRepository } from '../repositories/post.repository.js';

export type PostType = 'morning' | 'afternoon' | 'evening';

export interface GeneratedPostPayload {
  type: PostType;
  topic: string;
  content: string;
  hashtags: string;
}

export interface ThemedPostPayload {
  headline: string[];
  subheadline: string;
  caption: string;
  hashtags: string;
}

export interface TwitterVariantPayload {
  content: string;
  hashtags: string;
}

export interface InstagramVariantPayload {
  caption: string;
  hashtags: string;
}

const DUPLICATE_SIMILARITY_THRESHOLD = 0.7;
const MAX_GENERATION_ATTEMPTS = 3;
const TWITTER_CHAR_LIMIT = 280;
const REQUIRED_HASHTAG_COUNT = 4;

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })).optional(),
          })
          .optional(),
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

function describeTopic(topic: ServiceTopic): string {
  return `${topic.name} ("${topic.tagline}") — key capabilities: ${topic.capabilities.join(', ')}`;
}

export class GeminiService {
  constructor(private readonly postRepository: PostRepository) {}

  private buildLinkedInPrompt(postType: PostType, topic: ServiceTopic): string {
    const angles = {
      morning: 'an educational angle: teach the reader something actionable about this service',
      afternoon: 'an industry-insight angle: a sharp observation or trend related to this service',
      evening:
        'an engagement angle: a conversation-starting question or opinion about this service',
    };

    return `Create exactly one high-performing LinkedIn post for ${BRAND.name}, a ${BRAND.tagline}
(${BRAND.website}).

Write about this specific service: ${describeTopic(topic)}

Requirements:
- Approach: ${angles[postType]}.
- Must contain a viral hook, emojis, at least 3 bullet points when helpful, and a clear CTA.
- End with a CTA that invites the reader to reach out to ${BRAND.name} at ${BRAND.supportEmail}.
- Tone should be polished, original, and distinctive - written as ${BRAND.name}, not generically.
- Keep the content between 180 and 300 words.
- Output JSON only with keys: content, hashtags.
- "hashtags" MUST be a single space-separated string of EXACTLY ${REQUIRED_HASHTAG_COUNT}
  relevant hashtags (e.g. "#CloudNative #DevOps #Kubernetes #Alphazox"), NOT a JSON array, not
  more and not fewer than ${REQUIRED_HASHTAG_COUNT}.
- Ensure the content is uniquely phrased and not generic.`;
  }

  async generateMorningPost(topic: ServiceTopic): Promise<GeneratedPostPayload> {
    return this.generateLinkedInPost('morning', topic);
  }

  async generateAfternoonPost(topic: ServiceTopic): Promise<GeneratedPostPayload> {
    return this.generateLinkedInPost('afternoon', topic);
  }

  async generateEveningPost(topic: ServiceTopic): Promise<GeneratedPostPayload> {
    return this.generateLinkedInPost('evening', topic);
  }

  private async generateLinkedInPost(
    postType: PostType,
    topic: ServiceTopic,
  ): Promise<GeneratedPostPayload> {
    const prompt = this.buildLinkedInPrompt(postType, topic);

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const rawText = await this.callGeminiApi(prompt, `LinkedIn(${postType})`, attempt);

      if (rawText === null) {
        continue;
      }

      const validation = GeneratedPostSchema.safeParse(this.safeParseJson(rawText));

      if (!validation.success) {
        appLogger.warn(`Gemini response failed schema validation for LinkedIn ${postType}`, {
          attempt,
          issues: validation.error.issues.map((issue) => issue.message),
        });
        continue;
      }

      const { content, hashtags } = validation.data;

      if (countHashtags(hashtags) !== REQUIRED_HASHTAG_COUNT) {
        appLogger.warn('LinkedIn post did not have exactly the required hashtag count', {
          attempt,
          count: countHashtags(hashtags),
        });
        continue;
      }

      if (await this.isDuplicateAgainstRecent(content, 'linkedin')) {
        appLogger.info(`Duplicate detected for LinkedIn ${postType}; regenerating content`, {
          attempt,
        });
        continue;
      }

      return { type: postType, topic: topic.name, content, hashtags };
    }

    throw new GeminiServiceError(
      `Unable to generate a unique LinkedIn ${postType} post after retries`,
    );
  }

  async generateTwitterVariant(
    topic: string,
    sourceContent: string,
  ): Promise<TwitterVariantPayload> {
    const prompt = `Rewrite the following idea as a single, punchy tweet for X/Twitter, for
${BRAND.name} (${BRAND.tagline}).
Idea/topic: ${topic}
Source LinkedIn post (for context only, do not copy verbatim):
"""
${sourceContent}
"""
Requirements:
- The tweet text plus hashtags together must be under ${TWITTER_CHAR_LIMIT} characters TOTAL.
- Include "${BRAND.supportEmail}" in the tweet if space allows; if it genuinely doesn't fit,
  prioritize the hashtags and core message instead.
- Punchy, original phrasing - do not copy sentences from the source post.
- Output JSON only with keys: content, hashtags.
- "hashtags" MUST be a single space-separated string of EXACTLY ${REQUIRED_HASHTAG_COUNT}
  hashtags, NOT a JSON array.`;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const rawText = await this.callGeminiApi(prompt, 'Twitter', attempt);

      if (rawText === null) {
        continue;
      }

      const validation = TwitterVariantSchema.safeParse(this.safeParseJson(rawText));

      if (!validation.success) {
        appLogger.warn('Gemini response failed schema validation for Twitter variant', {
          attempt,
          issues: validation.error.issues.map((issue) => issue.message),
        });
        continue;
      }

      const { content, hashtags } = validation.data;
      const combinedLength = `${content} ${hashtags}`.trim().length;

      if (combinedLength > TWITTER_CHAR_LIMIT) {
        appLogger.warn('Twitter variant exceeded character limit; regenerating', {
          attempt,
          combinedLength,
        });
        continue;
      }

      if (countHashtags(hashtags) !== REQUIRED_HASHTAG_COUNT) {
        appLogger.warn('Twitter variant did not have exactly the required hashtag count', {
          attempt,
          count: countHashtags(hashtags),
        });
        continue;
      }

      if (await this.isDuplicateAgainstRecent(content, 'twitter')) {
        appLogger.info('Duplicate detected for Twitter variant; regenerating content', { attempt });
        continue;
      }

      return { content, hashtags };
    }

    throw new GeminiServiceError('Unable to generate a unique Twitter post after retries');
  }

  async generateInstagramVariant(
    topic: string,
    sourceContent: string,
  ): Promise<InstagramVariantPayload> {
    const prompt = `Rewrite the following idea as an Instagram caption, for
${BRAND.name} (${BRAND.tagline}).
Idea/topic: ${topic}
Source LinkedIn post (for context only, do not copy verbatim):
"""
${sourceContent}
"""
Requirements:
- caption: 100-150 words, engaging, emojis welcome, ends with a call to action inviting readers
  to reach out at ${BRAND.supportEmail}.
- hashtags: a single space-separated string of EXACTLY ${REQUIRED_HASHTAG_COUNT} relevant
  hashtags (e.g. "#AI #Enterprise #Alphazox #Innovation"), NOT a JSON array.
- Output JSON only with keys: caption, hashtags.`;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const rawText = await this.callGeminiApi(prompt, 'Instagram', attempt);

      if (rawText === null) {
        continue;
      }

      const validation = InstagramVariantSchema.safeParse(this.safeParseJson(rawText));

      if (!validation.success) {
        appLogger.warn('Gemini response failed schema validation for Instagram variant', {
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

      if (await this.isDuplicateAgainstRecent(caption, 'instagram')) {
        appLogger.info('Duplicate detected for Instagram variant; regenerating content', {
          attempt,
        });
        continue;
      }

      return { caption, hashtags };
    }

    throw new GeminiServiceError('Unable to generate a unique Instagram post after retries');
  }

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
      const rawText = await this.callGeminiApi(prompt, `Themed(${theme.id})`, attempt);

      if (rawText === null) {
        continue;
      }

      const validation = ThemedPostSchema.safeParse(this.safeParseJson(rawText));

      if (!validation.success) {
        appLogger.warn(`Gemini response failed schema validation for themed post`, {
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

      if (await this.isDuplicateAgainstRecent(caption, 'instagram')) {
        appLogger.info(`Duplicate detected for themed post (${theme.id}); regenerating content`, {
          attempt,
        });
        continue;
      }

      return { headline, subheadline, caption, hashtags };
    }

    throw new GeminiServiceError(`Unable to generate a unique themed post (${theme.id}) after retries`);
  }

  private async callGeminiApi(
    prompt: string,
    label: string,
    attempt: number,
  ): Promise<string | null> {
    appLogger.info('Calling Gemini generateContent API', {
      label,
      attempt,
      model: env.GEMINI_MODEL,
    });

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        },
        {
          headers: {
            'x-goog-api-key': env.GEMINI_API_KEY,
            'Content-Type': 'application/json',
          },
          // Gemini's "thinking" mode can occasionally run past 30s even for
          // short structured-output prompts; give it more headroom before
          // treating it as a failure and burning a retry.
          timeout: 60000,
        },
      );

      const validation = GeminiResponseSchema.safeParse(response.data);

      if (!validation.success) {
        appLogger.warn('Gemini response envelope failed schema validation', { label, attempt });
        return null;
      }

      return validation.data.candidates[0]?.content?.parts?.[0]?.text ?? '';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appLogger.error('Gemini API call failed', { label, attempt, error: message });

      if (attempt === MAX_GENERATION_ATTEMPTS) {
        throw new GeminiServiceError(message);
      }

      return null;
    }
  }

  private async isDuplicateAgainstRecent(text: string, platform: string): Promise<boolean> {
    const recentPosts = await this.postRepository.findRecentPostsByPlatform(platform, 20);
    return recentPosts.some(
      (post) => calculateTextSimilarity(post.content, text) >= DUPLICATE_SIMILARITY_THRESHOLD,
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
