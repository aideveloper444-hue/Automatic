import axios, { AxiosInstance } from 'axios';
import type { ZodType } from 'zod';
import { env } from '../config/env.js';
import { appLogger } from '../config/logger.js';
import { retryWithBackoff } from '../utils/retry.js';
import { BufferServiceError } from '../utils/errors.js';
import {
  BufferChannelsDataSchema,
  BufferCreatePostDataSchema,
  BufferDeletePostDataSchema,
  BufferOrganizationsDataSchema,
  GraphQLEnvelopeSchema,
} from '../validation/buffer.schema.js';
import type { PostRepository } from '../repositories/post.repository.js';

export type BufferChannelService = 'linkedin' | 'twitter' | 'instagram';

export interface SchedulePostInput {
  postId: number;
  text: string;
  scheduledAt: string;
  service: BufferChannelService;
  /** Required for Instagram: a publicly fetchable image URL (Buffer has no upload endpoint). */
  imageUrl?: string;
}

const CREATE_POST_RESULT_FRAGMENT = `
  __typename
  ... on PostActionSuccess {
    post { id text dueAt status }
  }
  ... on NotFoundError { message }
  ... on UnauthorizedError { message }
  ... on UnexpectedError { message }
  ... on RestProxyError { message }
  ... on LimitReachedError { message }
  ... on InvalidInputError { message }
`;

export class BufferService {
  private readonly client: AxiosInstance = axios.create({
    baseURL: 'https://api.buffer.com',
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${env.BUFFER_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  private cachedOrganizationId: string | null = null;
  private readonly cachedChannelIdsByService = new Map<BufferChannelService, string[]>();
  private cachedChannels: Array<{ id: string; service?: string }> | null = null;

  constructor(private readonly postRepository: PostRepository) {}

  /**
   * Buffer's GraphQL API (https://api.buffer.com) replaced the legacy REST
   * API (api.bufferapp.com/1/...), which now rejects Public API tokens.
   * Every request is a POST of { query, variables } to the same endpoint.
   * We always pass the whole `input` argument as a single variable typed to
   * the exact Input Object type from the schema (e.g. CreatePostInput!) so
   * the server coerces nested custom scalars (ChannelId, OrganizationId,
   * DateTime) itself, instead of us having to declare each one.
   */
  private async graphqlRequest<T>(
    query: string,
    dataSchema: ZodType<T>,
    label: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    let response;
    try {
      response = await this.client.post('/', { query, variables });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const envelope = GraphQLEnvelopeSchema.safeParse(error.response.data);
        const details = envelope.success ? envelope.data.errors?.map((e) => e.message).join('; ') : '';
        const retryAfter = error.response.headers['retry-after'];
        error.message = [
          `${label}: Buffer API rate limit exceeded`,
          details,
          typeof retryAfter === 'string' ? `Retry-After: ${retryAfter} seconds` : '',
        ]
          .filter(Boolean)
          .join('. ');
      }
      throw error;
    }

    const envelope = GraphQLEnvelopeSchema.safeParse(response.data);

    if (!envelope.success) {
      throw new BufferServiceError(`${label}: malformed GraphQL response`);
    }

    if (envelope.data.errors?.length) {
      const message = envelope.data.errors.map((e) => e.message).join('; ');
      throw new BufferServiceError(`${label}: ${message}`);
    }

    const parsedData = dataSchema.safeParse(envelope.data.data);

    if (!parsedData.success) {
      throw new BufferServiceError(`${label}: response failed schema validation`);
    }

    return parsedData.data;
  }

  private async getOrganizationId(forceRefresh = false): Promise<string> {
    if (this.cachedOrganizationId && !forceRefresh) {
      return this.cachedOrganizationId;
    }

    const data = await this.graphqlRequest(
      `query GetOrganizations { account { organizations { id name } } }`,
      BufferOrganizationsDataSchema,
      'getOrganizationId',
    );

    const organization = data.account.organizations[0];

    if (!organization) {
      throw new BufferServiceError('No Buffer organization found on this account');
    }

    this.cachedOrganizationId = organization.id;
    return organization.id;
  }

  async getChannelIds(service: BufferChannelService, forceRefresh = false): Promise<string[]> {
    if (forceRefresh) {
      this.cachedChannels = null;
    }

    const cached = this.cachedChannelIdsByService.get(service);
    if (cached && !forceRefresh) {
      return cached;
    }

    return retryWithBackoff(
      async (attempt) => {
        appLogger.info('Fetching Buffer channels', { service, attempt });

        const organizationId = await this.getOrganizationId(attempt > 1);
        if (!this.cachedChannels) {
          const data = await this.graphqlRequest(
            `query GetChannels($input: ChannelsInput!) {
              channels(input: $input) { id name service }
            }`,
            BufferChannelsDataSchema,
            `getChannelIds(${service})`,
            { input: { organizationId } },
          );
          this.cachedChannels = data.channels;
        }

        const channelIds = this.cachedChannels
          .filter((channel) => channel.service === service)
          .map((channel) => channel.id);

        if (!channelIds.length) {
          throw new BufferServiceError(
            `No connected "${service}" channels were found on this Buffer account`,
          );
        }

        this.cachedChannelIdsByService.set(service, channelIds);
        appLogger.info('Fetched Buffer channels', { service, count: channelIds.length });
        return channelIds;
      },
      {
        retries: 3,
        delayMs: 500,
        label: `Buffer getChannelIds(${service})`,
        shouldRetry: (error) => !(axios.isAxiosError(error) && error.response?.status === 429),
      },
    );
  }

  private buildCreatePostInput(
    channelId: string,
    input: SchedulePostInput,
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {
      text: input.text,
      channelId,
      schedulingType: 'automatic',
      mode: 'customScheduled',
      dueAt: input.scheduledAt,
      needsApproval: false,
      assets: input.imageUrl ? [{ image: { url: input.imageUrl } }] : [],
    };

    if (input.service === 'instagram') {
      base.metadata = {
        instagram: {
          type: 'post',
          isAiGenerated: true,
          shouldShareToFeed: true,
        },
      };
    }

    return base;
  }

  async schedulePost(input: SchedulePostInput): Promise<string> {
    const { postId, service, scheduledAt } = input;

    try {
      if (service === 'instagram' && !input.imageUrl) {
        throw new BufferServiceError('Instagram posts require an imageUrl');
      }

      const channelIds = await retryWithBackoff(
        async (attempt) => this.getChannelIds(service, attempt > 1),
        { retries: 2, delayMs: 500, label: `Buffer resolve channels for post(${postId})` },
      );

      const createdPostIds: string[] = [];

      for (const channelId of channelIds) {
        const bufferPostId = await retryWithBackoff(
          async (attempt) => {
            appLogger.info('Scheduling post to Buffer channel', {
              postId,
              service,
              channelId,
              attempt,
              scheduledAt,
            });

            const data = await this.graphqlRequest(
              `mutation CreateScheduledPost($input: CreatePostInput!) {
                createPost(input: $input) {
                  ${CREATE_POST_RESULT_FRAGMENT}
                }
              }`,
              BufferCreatePostDataSchema,
              `createPost(service=${service}, channel=${channelId})`,
              { input: this.buildCreatePostInput(channelId, input) },
            );

            if (!data.createPost.post?.id) {
              throw new BufferServiceError(
                data.createPost.message ??
                  `Buffer createPost returned ${data.createPost.__typename} with no message`,
              );
            }

            return data.createPost.post.id;
          },
          {
            retries: 3,
            delayMs: 1000,
            label: `Buffer createPost(service=${service}, channel=${channelId})`,
            shouldRetry: (error) => !(axios.isAxiosError(error) && error.response?.status === 429),
          },
        );

        createdPostIds.push(bufferPostId);
      }

      const combinedId = createdPostIds.join(',');

      await this.postRepository.markAsPublished(postId, combinedId);
      await this.postRepository.createLog({
        level: 'info',
        message: `Post scheduled to Buffer (${service})`,
        metadata: JSON.stringify({ bufferPostIds: createdPostIds, scheduledAt, service }),
        postId,
      });
      appLogger.info('Post scheduled to Buffer', {
        postId,
        service,
        bufferPostIds: createdPostIds,
        scheduledAt,
      });

      return combinedId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.postRepository.createLog({
        level: 'error',
        message: `Failed to schedule post to Buffer (${service}): ${message}`,
        postId,
      });
      throw error instanceof BufferServiceError ? error : new BufferServiceError(message);
    }
  }

  /**
   * Removes a post from Buffer's queue (works for both pending-approval and
   * already-scheduled posts). `bufferPostId` is the id returned by
   * schedulePost() - for a post that went to multiple channels this is a
   * comma-joined list, so callers should delete each id individually.
   */
  async deletePost(bufferPostId: string): Promise<void> {
    await retryWithBackoff(
      async (attempt) => {
        appLogger.info('Deleting post from Buffer', { bufferPostId, attempt });

        const data = await this.graphqlRequest(
          `mutation DeletePost($input: DeletePostInput!) {
            deletePost(input: $input) {
              __typename
              ... on DeletePostSuccess { id }
              ... on VoidMutationError { message }
            }
          }`,
          BufferDeletePostDataSchema,
          `deletePost(${bufferPostId})`,
          { input: { id: bufferPostId } },
        );

        if (data.deletePost.__typename !== 'DeletePostSuccess') {
          throw new BufferServiceError(
            data.deletePost.message ?? `Buffer deletePost returned ${data.deletePost.__typename}`,
          );
        }

        appLogger.info('Deleted post from Buffer', { bufferPostId });
      },
      { retries: 3, delayMs: 1000, label: `Buffer deletePost(${bufferPostId})` },
    );
  }
}
