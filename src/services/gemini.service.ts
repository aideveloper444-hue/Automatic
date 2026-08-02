import axios from 'axios';
import { z } from 'zod';
import { env } from '../config/env.js';
import { appLogger } from '../config/logger.js';
import { calculateTextSimilarity } from '../utils/similarity.js';
import { GeminiServiceError } from '../utils/errors.js';
import {
  GeneratedPostSchema,
  InstagramVariantSchema,
  TwitterVariantSchema,
} from '../validation/content.schema.js';
import type { PostRepository } from '../repositories/post.repository.js';

export type PostType = 'morning' | 'afternoon' | 'evening';

export interface GeneratedPostPayload {
  type: PostType;
  topic: string;
  content: string;
  hashtags: string;
}

export interface TwitterVariantPayload {
  content: string;
  hashtags: string;
}

export interface InstagramVariantPayload {
  caption: string;
  hashtags: string;
  imagePrompt: string;
}

const DUPLICATE_SIMILARITY_THRESHOLD = 0.7;
const MAX_GENERATION_ATTEMPTS = 3;
const TWITTER_CHAR_LIMIT = 280;

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

export class GeminiService {
  constructor(private readonly postRepository: PostRepository) {}

  private buildLinkedInPrompt(postType: PostType): string {
    const instructions = {
      morning: {
        title: 'Morning Educational',
        focus: 'teach an actionable lesson related to software engineering or SaaS',
      },
      afternoon: {
        title: 'Afternoon Industry Insight',
        focus: 'share a sharp trend, observation, or market insight',
      },
      evening: {
        title: 'Evening Engagement',
        focus: 'start a conversation through a challenge, opinion, or relatable experience',
      },
    };

    const template = instructions[postType];

    return `Create exactly one high-performing LinkedIn post. Requirements:
- Post type: ${template.title}
- Focus: ${template.focus}
- Must contain a viral hook, emojis, at least 3 bullet points when helpful, a CTA, and 3-5 hashtags.
- Tone should be polished, original, and distinctive.
- Do not repeat any previous topics, wording, or style.
- Output JSON only with keys: content, hashtags, topic.
- "hashtags" MUST be a single space-separated string (e.g. "#SaaS #AI #Startup"), NOT a JSON array.
- Keep the content between 180 and 300 words.
- Use a clear CTA such as 'What are you building this week?' or 'What would you add?'
- Include hashtags like #SaaS #AI #LinkedInGrowth #Startup #Productivity
- Ensure the content is uniquely phrased and not generic.`;
  }

  async generateMorningPost(): Promise<GeneratedPostPayload> {
    return this.generateLinkedInPost('morning');
  }

  async generateAfternoonPost(): Promise<GeneratedPostPayload> {
    return this.generateLinkedInPost('afternoon');
  }

  async generateEveningPost(): Promise<GeneratedPostPayload> {
    return this.generateLinkedInPost('evening');
  }

  private async generateLinkedInPost(postType: PostType): Promise<GeneratedPostPayload> {
    const prompt = this.buildLinkedInPrompt(postType);

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

      const { content, hashtags, topic } = validation.data;

      if (await this.isDuplicateAgainstRecent(content, 'linkedin')) {
        appLogger.info(`Duplicate detected for LinkedIn ${postType}; regenerating content`, {
          attempt,
        });
        continue;
      }

      return { type: postType, topic, content, hashtags };
    }

    throw new GeminiServiceError(
      `Unable to generate a unique LinkedIn ${postType} post after retries`,
    );
  }

  async generateTwitterVariant(
    topic: string,
    sourceContent: string,
  ): Promise<TwitterVariantPayload> {
    const prompt = `Rewrite the following idea as a single, punchy tweet for X/Twitter.
Idea/topic: ${topic}
Source LinkedIn post (for context only, do not copy verbatim):
"""
${sourceContent}
"""
Requirements:
- The tweet text plus hashtags together must be under ${TWITTER_CHAR_LIMIT} characters TOTAL.
- Keep 1-2 relevant hashtags at most.
- Emojis optional, use sparingly.
- Punchy, original phrasing - do not copy sentences from the source post.
- Output JSON only with keys: content, hashtags.
- "hashtags" MUST be a single space-separated string (e.g. "#SaaS #AI"), NOT a JSON array.`;

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
    const prompt = `Rewrite the following idea as an Instagram caption, plus an image prompt.
Idea/topic: ${topic}
Source LinkedIn post (for context only, do not copy verbatim):
"""
${sourceContent}
"""
Requirements:
- caption: 100-150 words, engaging, emojis welcome, ends with a call to action.
- hashtags: 5-8 relevant hashtags as a single space-separated string (e.g. "#SaaS #AI #Startup"),
  NOT a JSON array.
- imagePrompt: a vivid, concrete visual description for an AI image generator that represents
  this idea. The described image must contain NO readable text, words, or letters in it -
  describe only visual elements, style, mood, and composition.
- Output JSON only with keys: caption, hashtags, imagePrompt.`;

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

      const { caption, hashtags, imagePrompt } = validation.data;

      if (await this.isDuplicateAgainstRecent(caption, 'instagram')) {
        appLogger.info('Duplicate detected for Instagram variant; regenerating content', {
          attempt,
        });
        continue;
      }

      return { caption, hashtags, imagePrompt };
    }

    throw new GeminiServiceError('Unable to generate a unique Instagram post after retries');
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
          timeout: 30000,
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
