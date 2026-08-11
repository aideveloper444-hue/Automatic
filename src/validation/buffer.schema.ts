import { z } from 'zod';

export const GraphQLErrorSchema = z.object({
  message: z.string(),
});

export const GraphQLEnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(GraphQLErrorSchema).optional(),
});

export const BufferOrganizationSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
});

export const BufferOrganizationsDataSchema = z.object({
  account: z.object({
    organizations: z.array(BufferOrganizationSchema),
  }),
});

export const BufferChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  service: z.string().optional(),
});

export const BufferChannelsDataSchema = z.object({
  channels: z.array(BufferChannelSchema),
});

// createPost resolves to the PostActionPayload union: PostActionSuccess on
// success, or one of several typed errors (NotFoundError, UnauthorizedError,
// UnexpectedError, RestProxyError, LimitReachedError, InvalidInputError),
// each of which exposes a `message` field. We select __typename plus both
// shapes and branch on whichever came back populated.
export const BufferCreatePostDataSchema = z.object({
  createPost: z.object({
    __typename: z.string(),
    post: z
      .object({
        id: z.string().min(1),
        text: z.string().optional(),
        dueAt: z.string().nullish(),
        status: z.string().optional(),
      })
      .optional(),
    message: z.string().optional(),
  }),
});

// deletePost resolves to the DeletePostPayload union: DeletePostSuccess on
// success, or VoidMutationError with a message. Same branch-on-whichever-
// came-back pattern as BufferCreatePostDataSchema above.
export const BufferDeletePostDataSchema = z.object({
  deletePost: z.object({
    __typename: z.string(),
    id: z.string().min(1).optional(),
    message: z.string().optional(),
  }),
});

export type BufferChannel = z.infer<typeof BufferChannelSchema>;
