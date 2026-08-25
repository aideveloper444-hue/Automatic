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

/**
 * Deliberately just a plain research ask, with no structured-output format
 * demanded - asking a search-enabled model to also produce a strict 7-field
 * template in the same turn was pushing Groq's `compound` model into
 * excessive multi-query search fan-out, which intermittently tripped a
 * request-size guard ("413 Request Entity Too Large") independent of this
 * prompt's own size - reproduced even on a clean GitHub Actions runner with
 * no prior calls, so it wasn't a rate-limit artifact. Structuring into the
 * NewsStory shape now happens as a separate, non-search extraction call -
 * see extractStory().
 */
function buildSearchPrompt(recentHeadlines: string[]): string {
  const avoidBlock =
    recentHeadlines.length > 0
      ? ` Avoid picking a story matching any of these recently-covered angles: ${recentHeadlines.slice(0, 8).join(' | ')}.`
      : '';

  return `Search the web for today's single most important technology/IT news story. The beat is: ${TOPIC_SUMMARY}.${avoidBlock}

Only report a real story you actually found via search - never invent one. Prefer original sources, official
company announcements, or reputable technology/business publications. Tell me: the headline, the source
publication/company name and its URL, whether the story is still developing/unconfirmed, whether it's about stock
prices/earnings/market movements, and a summary of what happened, what technology is involved, why it matters for
businesses and IT leaders, and what could happen next.`;
}

function buildExtractionPrompt(rawText: string): string {
  return `Extract the single news story described below into the exact JSON shape requested. Do not add, invent, or
change any facts - only restructure what's already stated.

Research text:
"""
${rawText}
"""

Output JSON only with this exact shape:
{
  "headline": "<one factual headline, under 20 words>",
  "category": "<exactly one of: ${CATEGORY_IDS}>",
  "sourceName": "<the source publication/company name>",
  "sourceUrl": "<the source URL, or 'unknown' if none was given>",
  "isDeveloping": <true or false - true only if the text says this is still unfolding/unconfirmed>,
  "isMarketStory": <true or false - true only if this is about stock prices, earnings, Nasdaq, or market movements>,
  "summary": "<4-8 sentences covering what happened, why it matters, and what could happen next. If isMarketStory is
    true, structure it as two clearly labeled parts: 'FACT: ...' for only what happened, and 'ANALYSIS: ...' for
    why it may be happening - never a buy/sell recommendation or guaranteed prediction.>"
}`;
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

const GroqJsonResponseSchema = GroqCompoundResponseSchema;

/**
 * Live news discovery for the hourly ALPHAZOX pipeline. Groq's `groq/compound`
 * model (built-in web search, already covered by the existing GROQ_API_KEY,
 * no extra billing) is the primary path - at this project's ~1 search/hour
 * cadence its free-tier limits are very unlikely to bind; the exhaustion
 * seen during development came from dozens of rapid manual test calls in one
 * session, not real usage. Gemini's "grounding with Google Search" tool -
 * genuinely backed by Google Search/News, not an approximation - is a
 * secondary path for whenever its account has billing enabled; until then it
 * fails fast (free-tier quota or an account-level block) and this falls
 * through to Groq, same primary+fallback resilience pattern as OpenAI image
 * generation -> Pexels elsewhere in this codebase.
 *
 * Both paths return freeform grounded text (see buildSearchPrompt), which
 * is then structured into the NewsStory shape by one shared, non-search
 * Groq JSON-mode call (extractStory) - more robust than asking a
 * search-enabled model to also hit a strict output format in one turn.
 */
export class NewsResearchService {
  async researchLatestStory(recentHeadlines: string[]): Promise<NewsStory> {
    const prompt = buildSearchPrompt(recentHeadlines);

    let rawText: string;
    let citation: { uri?: string; title?: string } | undefined;

    try {
      rawText = await this.searchViaGroqCompound(prompt);
    } catch (error) {
      appLogger.warn('Groq compound web search failed; falling back to Gemini Google Search grounding', {
        error: error instanceof Error ? error.message : String(error),
      });
      const result = await this.searchViaGemini(prompt);
      rawText = result.text;
      citation = result.citation;
    }

    const story = await this.extractStory(rawText);

    // Prefer a real grounding citation URL over whatever URL the model wrote
    // in prose, if Gemini actually attached one for this response.
    if (citation?.uri) {
      story.sourceUrl = citation.uri;
      if (citation.title) {
        story.sourceName = citation.title;
      }
    }

    appLogger.info('News research succeeded', { headline: story.headline, category: story.category });
    return story;
  }

  private async searchViaGemini(prompt: string): Promise<{ text: string; citation?: { uri?: string; title?: string } }> {
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

    if (!text.trim()) {
      throw new NewsResearchServiceError('Gemini returned an empty research response');
    }

    const groundingChunk = validation.data.candidates[0]?.groundingMetadata?.groundingChunks?.[0]?.web;
    return { text, citation: groundingChunk };
  }

  /**
   * `groq/compound-mini` was tried here first since it's documented as one
   * tool call per request. In practice compound-mini often declines to
   * search at all ("I'm unable to perform a live web search") rather than
   * using its one allowed call, which is worse - so this uses full
   * `groq/compound` with a retry instead, now that the simplified prompt
   * (see buildSearchPrompt) has largely stopped triggering the 413s that
   * motivated trying compound-mini in the first place.
   */
  private async searchViaGroqCompound(prompt: string): Promise<string> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      appLogger.info('Researching latest story via Groq compound (web search fallback)', { attempt });

      try {
        const response = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'groq/compound',
            messages: [{ role: 'user', content: prompt }],
            max_completion_tokens: 700,
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

        if (!text.trim()) {
          throw new NewsResearchServiceError('Groq compound returned an empty research response');
        }

        return text;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        appLogger.warn('Groq compound research attempt failed', { attempt, error: message });

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw lastError instanceof NewsResearchServiceError ? lastError : new NewsResearchServiceError(message);
  }

  /** Non-search Groq JSON-mode call that structures raw grounded text into the NewsStory shape. */
  private async extractStory(rawText: string): Promise<NewsStory> {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: env.GROQ_MODEL,
        messages: [{ role: 'user', content: buildExtractionPrompt(rawText) }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 1200,
      },
      {
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      },
    );

    const validation = GroqJsonResponseSchema.safeParse(response.data);

    if (!validation.success) {
      throw new NewsResearchServiceError('Story extraction response failed schema validation');
    }

    const content = validation.data.choices[0]?.message?.content ?? '';

    let json: unknown;
    try {
      json = JSON.parse(content.replace(/```json|```/g, '').trim());
    } catch {
      throw new NewsResearchServiceError('Could not parse extracted story JSON');
    }

    if (typeof json === 'object' && json !== null && 'category' in json) {
      const raw = json as Record<string, unknown>;
      const category = typeof raw.category === 'string' ? raw.category.toLowerCase().trim() : '';
      raw.category = NEWS_CATEGORIES[category] ? category : 'enterprise-it';
    }

    const result = NewsStorySchema.safeParse(json);

    if (!result.success) {
      throw new NewsResearchServiceError('Extracted story failed validation');
    }

    return result.data;
  }
}
