import axios from 'axios';
import { z } from 'zod';
import { env } from '../config/env.js';
import { appLogger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';
import { NEWS_CATEGORIES } from '../config/news-categories.js';
import { NewsStorySchema, type NewsStory } from '../validation/news.schema.js';

export class NewsResearchServiceError extends AppError {
  constructor(message: string) {
    super(`News research service error: ${message}`, 502);
  }
}

const TOPIC_SUMMARY =
  'AI/agentic AI/LLMs, AI chips/GPUs/semiconductors, cloud & data centers, cybersecurity, software/SaaS/DevOps, ' +
  'enterprise IT & digital transformation, quantum computing, Big Tech (Microsoft, Google, Amazon, Apple, Meta, ' +
  'Nvidia, AMD, Intel, OpenAI, Anthropic, Oracle, Salesforce, and similar), and U.S. tech markets/stocks/earnings/M&A';

const CATEGORY_IDS = Object.keys(NEWS_CATEGORIES).join(', ');

function buildResearchPrompt(recentHeadlines: string[]): string {
  const avoidBlock =
    recentHeadlines.length > 0
      ? `\nDo not pick a story matching any of these recently-covered angles: ${recentHeadlines.slice(0, 8).join(' | ')}\n`
      : '';

  return `You are a technology news researcher for ALPHAZOX, an IT and digital transformation company.

Do ONE web search for today's top technology news. The beat is: ${TOPIC_SUMMARY}.

Rules:
- Only report a real story you actually found via search. Never invent a story or facts.
- Prefer original sources, official company announcements, or reputable technology/business publications.
- If the story is still developing/unconfirmed in parts, you must say so.
${avoidBlock}
From what you find, pick the SINGLE most important technology development right now.

Respond in EXACTLY this plain-text format, with each field on its own line (SUMMARY may span multiple lines and must be last):

HEADLINE: <one factual headline, under 20 words>
CATEGORY: <exactly one of: ${CATEGORY_IDS}>
SOURCE_NAME: <name of the original/primary publication or company that reported this>
SOURCE_URL: <the direct URL of that source, if you have it, else "unknown">
IS_DEVELOPING: <true or false - true only if the story is still actively unfolding/unconfirmed>
IS_MARKET_STORY: <true or false - true only if this is about stock prices, earnings, Nasdaq, or market movements>
SUMMARY: <4-8 sentences: what happened, what technology is involved, why it matters, what it means for businesses/IT leaders, and what could happen next. If IS_MARKET_STORY is true, write it as two clearly labeled parts: "FACT: ..." stating only what happened, and "ANALYSIS: ..." for why it may be happening - never a buy/sell recommendation or guaranteed prediction.>`;
}

interface ParsedResearch {
  headline: string;
  category: string;
  sourceName: string;
  sourceUrl: string;
  isDeveloping: boolean;
  isMarketStory: boolean;
  summary: string;
}

function parseResearchText(text: string): ParsedResearch | null {
  const get = (field: string): string | undefined => {
    const match = text.match(new RegExp(`^${field}:\\s*(.+)$`, 'im'));
    return match?.[1]?.trim();
  };

  const summaryMatch = text.match(/^SUMMARY:\s*([\s\S]+)$/im);

  const headline = get('HEADLINE');
  const category = get('CATEGORY');
  const sourceName = get('SOURCE_NAME');
  const sourceUrl = get('SOURCE_URL');
  const isDeveloping = get('IS_DEVELOPING');
  const isMarketStory = get('IS_MARKET_STORY');
  const summary = summaryMatch?.[1]?.trim();

  if (!headline || !category || !sourceName || !sourceUrl || !summary) {
    return null;
  }

  return {
    headline,
    category: category.toLowerCase().trim(),
    sourceName,
    sourceUrl,
    isDeveloping: /true/i.test(isDeveloping ?? ''),
    isMarketStory: /true/i.test(isMarketStory ?? ''),
    summary,
  };
}

function toNewsStory(parsed: ParsedResearch): NewsStory | null {
  const category = NEWS_CATEGORIES[parsed.category] ? parsed.category : 'enterprise-it';

  const result = NewsStorySchema.safeParse({
    headline: parsed.headline,
    category,
    sourceName: parsed.sourceName,
    sourceUrl: parsed.sourceUrl,
    isDeveloping: parsed.isDeveloping,
    isMarketStory: parsed.isMarketStory,
    summary: parsed.summary,
  });

  return result.success ? result.data : null;
}

const GeminiGroundedResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })).optional(),
          })
          .optional(),
        groundingMetadata: z
          .object({
            groundingChunks: z
              .array(z.object({ web: z.object({ uri: z.string().optional(), title: z.string().optional() }).optional() }))
              .optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

const GroqCompoundResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().optional() }).optional(),
      }),
    )
    .min(1),
});

/**
 * Live news discovery for the hourly ALPHAZOX pipeline. Gemini's "grounding
 * with Google Search" tool is the primary path since it's genuinely backed
 * by Google Search/News, not an approximation. Structured JSON output mode
 * can't be combined with tools in the same Gemini call, so this asks for a
 * plain delimited text format instead and parses it - see parseResearchText.
 *
 * Falls back to Groq's `groq/compound` model (built-in web search, no
 * separate API key needed) if Gemini fails or its free-tier quota
 * (20 requests/day) is exhausted before this cadence's 24 runs/day - same
 * primary+fallback resilience pattern as OpenAI image generation -> Pexels
 * elsewhere in this codebase.
 */
export class NewsResearchService {
  async researchLatestStory(recentHeadlines: string[]): Promise<NewsStory> {
    const prompt = buildResearchPrompt(recentHeadlines);

    try {
      return await this.researchViaGemini(prompt);
    } catch (error) {
      appLogger.warn('Gemini news research failed; falling back to Groq compound web search', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return this.researchViaGroqCompound(prompt);
  }

  private async researchViaGemini(prompt: string): Promise<NewsStory> {
    appLogger.info('Researching latest story via Gemini (Google Search grounding)');

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 800 },
      },
      {
        headers: {
          'x-goog-api-key': env.GEMINI_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      },
    );

    const validation = GeminiGroundedResponseSchema.safeParse(response.data);

    if (!validation.success) {
      throw new NewsResearchServiceError('Gemini grounded response failed schema validation');
    }

    const text = validation.data.candidates[0]?.content?.parts?.[0]?.text ?? '';
    const parsed = parseResearchText(text);

    if (!parsed) {
      throw new NewsResearchServiceError('Could not parse Gemini research response');
    }

    // Prefer a real grounding citation URL over whatever URL the model wrote
    // in prose, if Gemini actually attached one for this response.
    const groundingChunk = validation.data.candidates[0]?.groundingMetadata?.groundingChunks?.[0]?.web;
    if (groundingChunk?.uri) {
      parsed.sourceUrl = groundingChunk.uri;
      if (groundingChunk.title) {
        parsed.sourceName = groundingChunk.title;
      }
    }

    const story = toNewsStory(parsed);

    if (!story) {
      throw new NewsResearchServiceError('Gemini research result failed validation');
    }

    appLogger.info('Gemini news research succeeded', { headline: story.headline, category: story.category });
    return story;
  }

  /**
   * `groq/compound-mini` was tried here first since it's documented as one
   * tool call per request (avoiding the multi-search fan-out that
   * intermittently trips Groq's request-size guard, "413 Request Entity Too
   * Large", on the full compound model). In practice compound-mini often
   * declines to search at all ("I'm unable to perform a live web search")
   * rather than using its one allowed call, which is worse - so this uses
   * full `groq/compound` with an explicit "you must search" instruction and
   * a retry, accepting the occasional 413 as a retryable failure instead.
   */
  private async researchViaGroqCompound(prompt: string): Promise<NewsStory> {
    const searchPrompt = `${prompt}\n\nYou MUST use your web search tool before answering - do not answer from memory or say you are unable to search.`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      appLogger.info('Researching latest story via Groq compound (web search fallback)', { attempt });

      try {
        const response = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'groq/compound',
            messages: [{ role: 'user', content: searchPrompt }],
            max_completion_tokens: 900,
          },
          {
            headers: {
              Authorization: `Bearer ${env.GROQ_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 60000,
          },
        );

        const validation = GroqCompoundResponseSchema.safeParse(response.data);

        if (!validation.success) {
          throw new NewsResearchServiceError('Groq compound response failed schema validation');
        }

        const text = validation.data.choices[0]?.message?.content ?? '';
        const parsed = parseResearchText(text);

        if (!parsed) {
          appLogger.warn('Groq compound response text that failed parsing', { text: text.slice(0, 500) });
          throw new NewsResearchServiceError('Could not parse Groq compound research response');
        }

        const story = toNewsStory(parsed);

        if (!story) {
          throw new NewsResearchServiceError('Groq compound research result failed validation');
        }

        appLogger.info('Groq compound-mini news research succeeded', {
          headline: story.headline,
          category: story.category,
        });
        return story;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        appLogger.warn('Groq compound-mini research attempt failed', { attempt, error: message });

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw lastError instanceof NewsResearchServiceError ? lastError : new NewsResearchServiceError(message);
  }
}
