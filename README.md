# Buffer AI Content Automation

A production-ready Node.js + TypeScript SaaS automation service that generates 3 unique daily
content ideas with Google's Gemini API, rewrites each one natively for **LinkedIn, Twitter/X, and
Instagram**, generates Instagram's image with the free Pollinations AI API, and schedules all of
them to Buffer — with zero manual work after deployment and near-zero running cost (Gemini free
tier, Pollinations is keyless/free, GitHub Actions free tier, Buffer's own free plan).

## What it does, every day, automatically

1. At **07:00 Asia/Kolkata (IST)**, the pipeline wakes up (via an internal `node-cron` job in the
   running server, and/or via the included GitHub Actions workflow).
2. For each of 3 daily slots, it generates one underlying idea as a **LinkedIn post** with Gemini,
   then rewrites that same idea natively for the other two channels:
   - **Morning — Educational**: an actionable lesson.
   - **Afternoon — Industry Insight**: a sharp trend or market observation.
   - **Evening — Engagement**: a conversation-starting question or opinion.
   - **LinkedIn**: 180–300 words, hook + bullets + CTA + hashtags + emojis.
   - **Twitter/X**: a single tweet, hard-capped under 280 characters (text + hashtags combined) —
     not a truncated LinkedIn post, a fresh punchy rewrite.
   - **Instagram**: a 100–150 word caption + hashtags + an AI-generated image (Gemini writes the
     image prompt, Pollinations AI generates the image for free, and it's uploaded to Cloudinary
     so Buffer can fetch it by a stable URL — see below).
3. Every generated post is checked against recent posts **on that same platform** for
   duplicate/similar content. If it's too similar, the model is asked to regenerate (up to 3
   attempts) rather than ever posting near-duplicate content.
4. It fetches your connected **LinkedIn / Twitter / Instagram channel IDs from Buffer
   automatically** (via Buffer's GraphQL API) and schedules all 9 posts (3 slots × 3 channels) to
   publish at **09:00, 14:00, and 19:00 IST** — Buffer itself handles the actual publish at that
   time, so nothing needs to stay running in between.
5. Each channel is scheduled independently and failures are isolated: if Instagram fails (e.g.
   Cloudinary not configured, Pollinations error), LinkedIn and Twitter for that slot still go
   out.
6. Every step (API calls, duplicate detection, scheduling, publishing, failures) is written to
   Winston logs (`logs/app.log`, `logs/error.log`) and to the `Log` table in the database.
7. Failed Buffer uploads are retried automatically with exponential backoff.

## Tech stack

Node.js · TypeScript · Express · Prisma ORM · SQLite (default) / PostgreSQL · Google Gemini API ·
Pollinations AI (free image generation) · Buffer GraphQL API · Cloudinary · Axios · Winston · Zod
· node-cron · GitHub Actions · Docker · ESLint · Prettier

## Architecture

```
src/
  config/        env.ts (Zod-validated environment), logger.ts (Winston)
  validation/     Zod schemas that validate every Gemini / Buffer API response
  utils/          errors.ts, retry.ts (exponential backoff), similarity.ts (duplicate
                   detection), response.ts, asyncHandler.ts
  repositories/   post.repository.ts — all Prisma/database access
  services/
    gemini.service.ts     generateMorningPost() / generateAfternoonPost() /
                           generateEveningPost() produce the LinkedIn post (source of truth)
                           via the Gemini generateContent API; generateTwitterVariant() and
                           generateInstagramVariant() rewrite that same idea per platform
                           (the latter also writes the Instagram image prompt). All with
                           duplicate-content regeneration, scoped per platform.
    pollinations.service.ts generateImage() — free, keyless image generation
                           (image.pollinations.ai) from the Gemini-written image prompt
    buffer.service.ts     getChannelIds(service) (auto-fetches connected channel IDs per
                           platform via Buffer's GraphQL API) and schedulePost() (createPost
                           mutation per channel, with retry; attaches image + Instagram
                           metadata when scheduling to Instagram)
    cloudinary.service.ts uploadImage() — re-hosts the Pollinations image at a stable URL so
                           Buffer can fetch it (Buffer's API has no upload endpoint of its own,
                           and this insulates the pipeline from Pollinations URL variability)
    scheduler.service.ts  node-cron job that runs the daily pipeline at 07:00 IST: one idea
                           per slot, scheduled independently to all 3 platforms
  controllers/    automation.controller.ts — manual trigger endpoint
  routes/         posts.route.ts — read-only API over generated posts
  middleware/     requestLogger.ts, errorHandler.ts
  container.ts    composition root — wires every dependency by constructor injection
  server.ts       Express app entrypoint (long-running process; owns the cron job)
scripts/
  generate-and-schedule.ts   one-shot entrypoint (no HTTP server) used by GitHub Actions:
                              runs the daily pipeline once and exits
  switch-db-provider.js      copies the sqlite or postgresql schema over prisma/schema.prisma
prisma/
  schema.prisma              active schema (SQLite by default)
  schema.sqlite.prisma        SQLite variant (source of truth for db:use:sqlite)
  schema.postgresql.prisma    PostgreSQL variant (source of truth for db:use:postgres)
```

The app follows dependency injection throughout: every service takes its dependencies via its
constructor (see `src/container.ts`), so each piece (Gemini, Pollinations, Cloudinary, Buffer,
persistence) can be tested or swapped independently.

### Database

Three tables, created via Prisma:

- **Post** — `content`, `hashtags`, `createdAt`, `published`, `bufferPostId`, `status`, plus
  `type` (morning/afternoon/evening), `platform` (linkedin/twitter/instagram), `imageUrl`
  (Instagram only), `duplicateScore`, and a `topicId` relation. One row per platform per slot —
  up to 9 rows/day.
- **Topic** — one row per service line, round-robin rotated via `lastUsedAt` (see below).
- **Log** — `level`, `message`, `metadata`, timestamped, optionally linked to a `Post`.

### Brand customization

`src/config/brand.ts` is where this deployment's identity lives: company name, tagline, website,
support email, the Instagram image style description, and the list of `SERVICE_TOPICS` content
rotates through. This instance is configured for **Alphazox** (10 service lines: Cloud Native
Solutions, AI Model Development, Enterprise Solutions, Data Engineering, Quality Assurance,
Product Design, Mobile App Maintenance, Cyber Security, IT Infrastructure, Emerging
Technologies). To reuse this project for a different company, edit that one file — no other
source changes needed.

Every post is generated about one specific service from that list, never a generic/invented
topic. `PostRepository.getNextTopic()` picks whichever service was used longest ago (round-robin
via `Topic.lastUsedAt`, ties broken by insertion order), so consecutive posts — and consecutive
days — cycle through all services rather than repeating one. Every generated post (LinkedIn,
Twitter, Instagram) mandates exactly 4 hashtags and a CTA pointing to the configured support
email; both are enforced in code (not just prompted for) — hashtag count is counted and
regenerated on mismatch, same pattern as the Twitter character-limit check.

### Duplicate detection

`src/utils/similarity.ts` computes Jaccard word-set similarity between a newly generated post and
the last 20 posts **on that same platform**. Anything at or above a 0.7 similarity score is
treated as a duplicate and triggers regeneration instead of being published — the pipeline never
knowingly schedules near-duplicate content.

### Instagram image generation and hosting

Gemini writes a visual `imagePrompt` (with an explicit "no readable text/letters" instruction, so
image models don't render garbled text) as part of `generateInstagramVariant()`. That prompt goes
to `pollinations.service.ts`, which calls `image.pollinations.ai/prompt/<prompt>` — free, no API
key. Buffer's `createPost` mutation requires a real, publicly fetchable image URL for Instagram
(its API has no upload endpoint), so rather than passing Pollinations' URL directly, the image
bytes are re-uploaded to Cloudinary (`cloudinary.service.ts`, signed upload via axios + Node's
built-in `crypto` — no SDK dependency) for a guaranteed-stable URL before scheduling. If
`CLOUDINARY_*` env vars aren't set, Instagram scheduling is skipped automatically for that run
(logged, not fatal) — LinkedIn and Twitter still go out normally.

## Environment variables

| Variable                | Required           | Default            | Purpose                                  |
| ----------------------- | ------------------ | ------------------ | ---------------------------------------- |
| `GEMINI_API_KEY`        | yes                | —                  | Google Gemini API key (free tier)        |
| `GEMINI_MODEL`          | no                 | `gemini-2.5-flash` | Gemini model passed to generateContent   |
| `BUFFER_API_KEY`        | yes                | —                  | Buffer GraphQL API key (see note below)  |
| `DATABASE_URL`          | no                 | `file:./dev.db`    | Prisma connection string                 |
| `PORT`                  | no                 | `3000`             | HTTP port for the Express server         |
| `TIMEZONE`              | no                 | `Asia/Kolkata`     | IANA timezone used for scheduling        |
| `POLLINATIONS_MODEL`    | no                 | `flux`             | Pollinations image model (free, keyless) |
| `CLOUDINARY_CLOUD_NAME` | only for Instagram | —                  | Cloudinary account cloud name            |
| `CLOUDINARY_API_KEY`    | only for Instagram | —                  | Cloudinary API key                       |
| `CLOUDINARY_API_SECRET` | only for Instagram | —                  | Cloudinary API secret                    |

Copy `.env.example` to `.env` and fill in the required keys. Without the three `CLOUDINARY_*`
vars, everything works except Instagram scheduling, which is skipped automatically.

**About `GEMINI_API_KEY`:** get a free key from
[Google AI Studio](https://aistudio.google.com/apikey) — no credit card
required for the free tier. `gemini.service.ts` calls the
`generateContent` REST endpoint directly (no SDK dependency) with
`responseMimeType: "application/json"` so responses parse straight into
structured post data.

**About `BUFFER_API_KEY`:** Buffer retired its legacy REST API
(`api.bufferapp.com/1/...`) for Public API tokens — this project talks to
Buffer's current GraphQL API (`https://api.buffer.com`) instead. Generate the
key from **Buffer → Settings → API**, not an old-style Public API OAuth
token. `buffer.service.ts` looks up your organization, lists channels
per-service (`linkedin` / `twitter` / `instagram`), and creates one scheduled
post per matching channel via the `createPost` mutation.

**About `POLLINATIONS_MODEL`:** no account or key needed — Pollinations AI
is free and keyless for this volume of usage (a few images/day).

**About `CLOUDINARY_*`:** create a free account at
[cloudinary.com](https://cloudinary.com), then copy **Cloud name**, **API
Key**, and **API Secret** from the dashboard into `.env`. No upload preset or
other setup needed — uploads are signed server-side.

## Local setup

```bash
npm install                 # also runs `prisma generate` via postinstall
cp .env.example .env        # then fill in GEMINI_API_KEY and BUFFER_API_KEY
npm run db:push              # creates the SQLite tables
npm run dev                  # starts the API + the 07:00 IST cron job
```

Trigger a full generate-and-schedule run manually at any time (useful for testing):

```bash
curl -X POST http://localhost:3000/api/automation/run
```

Or run the same pipeline as a one-shot script (no server, exits when done — this is what CI uses):

```bash
npm run generate:daily
```

## API

- `GET /health` — liveness check.
- `POST /api/automation/run` — runs the full generate-3-posts-and-schedule-to-Buffer pipeline once.
- `GET /api/posts?limit=20&offset=0&status=scheduled&platform=instagram` — list stored posts
  (`platform` is one of `linkedin` / `twitter` / `instagram`).
- `GET /api/posts/:id` — a single post, including its topic and logs.

## Production build

```bash
npm run build
npm start
```

## Docker

```bash
docker compose up --build -d
```

This builds the image, runs `prisma db push` automatically on container start (so first boot
needs no manual database setup), and starts the server with the internal 07:00 IST scheduler.
Data persists in named volumes (`db-data` for the SQLite file, `logs-data` for Winston logs).

To run against PostgreSQL instead:

```bash
docker compose --profile postgres up -d postgres
npm run db:use:postgres
# set DATABASE_URL=postgresql://buffer:buffer@postgres:5432/buffer_ai in .env
npm run prisma:generate
docker compose up --build -d app
```

## Switching to PostgreSQL (without Docker)

Prisma requires a static `provider` in `schema.prisma`, so this repo ships two source schemas and
a small script that copies the right one into place:

```bash
npm run db:use:postgres      # copies prisma/schema.postgresql.prisma -> prisma/schema.prisma
# update DATABASE_URL in .env to a postgresql:// connection string
npm run prisma:generate
npm run prisma:migrate       # or `npx prisma db push` for a quick sync
```

Run `npm run db:use:sqlite` at any time to switch back.

## GitHub Actions (zero-manual-work automation)

`.github/workflows/daily-automation.yml` runs `npm run generate:daily` every day at 01:30 UTC
(07:00 IST), plus on-demand via `workflow_dispatch`. It needs three repository secrets:

- `GEMINI_API_KEY`
- `BUFFER_API_KEY`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (optional — omit to skip
  Instagram)
- `DATABASE_URL` (optional — omit to use the default SQLite file)

**Persistence note:** GitHub-hosted runners are ephemeral. The workflow caches the SQLite file
between runs as a best-effort way to preserve post history (needed for duplicate detection)
across days, but a cache can be evicted. For a fully durable production deployment, point
`DATABASE_URL` at a persistent PostgreSQL instance (e.g. Neon, Supabase, Railway) instead — see
"Switching to PostgreSQL" above. In that mode you do not need the internal `node-cron` scheduler
running anywhere; GitHub Actions alone drives the whole pipeline daily.

If you deploy the server continuously (Docker/VPS) with its own `node-cron` job at 07:00 IST,
disable the GitHub Actions schedule (or vice versa) to avoid generating and scheduling posts
twice in one day.

## Code quality

```bash
npm run lint
npm run format
npm run typecheck
```

## Notes

This project is designed to run with zero manual intervention after deployment: choose either
the always-on Docker/VPS deployment (internal cron) or the GitHub Actions workflow (external
cron) as your daily trigger, keep your API keys valid, and the pipeline generates, verifies, and
schedules fresh LinkedIn, Twitter, and Instagram posts every day on its own. LinkedIn, Twitter,
and Instagram channels must already be connected in your Buffer account — this project schedules
to existing channels, it does not connect new ones.
