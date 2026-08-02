import { Router } from 'express';
import { z } from 'zod';
import type { PostRepository } from '../repositories/post.repository.js';
import { sendError, sendSuccess } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const ListPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
  platform: z.enum(['linkedin', 'twitter', 'instagram']).optional(),
});

export function buildPostsRouter(postRepository: PostRepository): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = ListPostsQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        sendError(res, 400, parsed.error.issues.map((issue) => issue.message).join(', '));
        return;
      }

      const posts = await postRepository.findMany(parsed.data);
      sendSuccess(res, posts, 'Posts retrieved');
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        sendError(res, 400, 'Post id must be an integer');
        return;
      }

      const post = await postRepository.findById(id);

      if (!post) {
        sendError(res, 404, `Post ${id} not found`);
        return;
      }

      sendSuccess(res, post, 'Post retrieved');
    }),
  );

  return router;
}
