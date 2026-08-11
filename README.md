# Buffer AI Content Automation

A production-ready Node.js + TypeScript SaaS automation service that generates one new content
idea every hour with Google's Gemini API, rewrites it natively for **LinkedIn, Twitter/X, and
Instagram**, renders an on-brand post card for all three (logo, headline, capability bullets, and
a topic icon, sized to each platform's own feed layout) entirely server-side with no external
image API, and schedules everything to Buffer — with zero manual work after deployment and
near-zero running cost (Gemini free tier, image rendering is local/free, GitHub Actions free tier,
Buffer's own free plan).

## What it does, every hour, automatically

1. At the top of every hour, the pipeline wakes up (via an internal `node-cron` job in the
   running server, and/or via the included GitHub Actions workflow).
2. It generates one underlying idea as a **LinkedIn post** with Gemini, then rewrites that same
   idea natively for the other two channels:
   - **LinkedIn**: 180–300 words, hook + bullets + CTA + hashtags + emojis, plus a rendered post
     card sized 1200×627 (LinkedIn's feed ratio).
   - **Twitter/X**: a single tweet, hard-capped under 280 characters (text + hashtags combined) —
     not a truncated LinkedIn post, a fresh punchy rewrite — plus a rendered post card sized
     1200×675 (Twitter's in-feed ratio).
   - **Instagram**: a 100–150 word caption + hashtags + a rendered post card sized 1080×1080
     (square).
   - All three images are the same branded template (logo, headline, tagline, capability bullets,
     topic icon, footer) driven by that slot's service topic from `brand.ts`, laid out per
     platform's own aspect ratio rather than one generic image reused everywhere. Every post gets
     exactly 4 hashtags and a CTA to the configured support email — enforced in code.
3. Every generated post is checked against recent posts **on that same platform** for
   duplicate/similar content. If it's too similar, the model is asked to regenerate (up to 3
   attempts) rather than ever posting near-duplicate content.
4. It fetches your connected **LinkedIn / Twitter / Instagram channel IDs from Buffer
   automatically** (via Buffer's GraphQL API) and schedules that hour's 3 posts (1 slot × 3
   channels) to publish a few minutes out — Buffer itself handles the actual publish at that
   time, so nothing needs to stay running in between.
5. Each channel is scheduled independently and failures are isolated. Instagram requires an image
   to post at all, so it's skipped entirely if Cloudinary isn't configured or image generation
   fails. LinkedIn and Twitter degrade gracefully instead — if their image fails to generate for
   any reason, they still post as text-only rather than losing the slot.
6. Every step (API calls, duplicate detection, scheduling, publishing, failures) is written to
   Winston logs (`logs/app.log`, `logs/error.log`) and to the `Log` table in the database.
7. Failed Buffer uploads are retried automatically with exponential backoff.

## Tech stack

Node.js · TypeScript · Express · Prisma ORM · SQLite (default) / PostgreSQL · Google Gemini API ·
Satori + resvg (server-side post card rendering) · Buffer GraphQL API · Cloudinary · Axios ·
Winston · Zod · node-cron · GitHub Actions · Docker · ESLint · Prettier

## Architecture

```
src/
  config/        env.ts (Zod-validated environment), logger.ts (Winston), brand.ts (identity,
                   service topics, per-platform image dimensions), icons.ts (one line-icon glyph
                   per service topic, drawn as Satori-native SVG element trees)
  assets/fonts/  static WOFF font files embedded into the rendered post cards (Satori requires
                   font bytes up front — it does not resolve system or CDN fonts)
  validation/     Zod schemas that validate every Gemini / Buffer API response
  utils/          errors.ts, retry.ts (exponential backoff), similarity.ts (duplicate
                   detection), response.ts, asyncHandler.ts
  repositories/   post.repository.ts — all Prisma/database access
  services/
    gemini.service.ts     generateMorningPost() / generateAfternoonPost() /
                           generateEveningPost() produce the LinkedIn post (source of truth) via
                           the Gemini generateContent API; generateTwitterVariant() and
                           generateInstagramVariant() rewrite that same idea per platform. All
                           with duplicate-content regeneration, scoped per platform.
    template.service.ts   renderServiceCard(topic, platform) — renders the branded post card
                           (logo, headline, tagline, capability bullets, topic icon, footer) to a
                           PNG at that platform's feed dimensions, via Satori (layout) + resvg
                           (rasterization); no external image API or network call involved
    buffer.service.ts     getChannelIds(service) (auto-fetches connected channel IDs per
                           platform via Buffer's GraphQL API) and schedulePost() (createPost
                           mutation per channel, with retry; attaches an image + Instagram
                           metadata when one is provided)
    cloudinary.service.ts uploadImage() — hosts the rendered post card at a stable public URL so
                           Buffer can fetch it (Buffer's API has no upload endpoint of its own)
    scheduler.service.ts  node-cron job that runs the pipeline every hour: one idea per run,
                           scheduled independently to all 3 platforms
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
constructor (see `src/container.ts`), so each piece (Gemini, template rendering, Cloudinary,
Buffer, persistence) can be tested or swapped independently.

### Database

Three tables, created via Prisma:

- **Post** — `content`, `hashtags`, `createdAt`, `published`, `bufferPostId`, `status`, plus
  `type` (morning/afternoon/evening), `platform` (linkedin/twitter/instagram), `imageUrl` (set
  whenever an image was generated for that post — always for Instagram, best-effort for
  LinkedIn/Twitter), `duplicateScore`, and a `topicId` relation. One row per platform per slot —
  up to 9 rows/day.
- **Topic** — one row per service line, round-robin rotated via `lastUsedAt` (see below).
- **Log** — `level`, `message`, `metadata`, timestamped, optionally linked to a `Post`.

### Brand customization

`src/config/brand.ts` is where this deployment's identity lives: company name, tagline, website,
support email, and the list of `SERVICE_TOPICS` (each with a tagline and capability bullets)
content rotates through. This instance is configured for **Alphazox** (10 service lines: Cloud
Native Solutions, AI Model Development, Enterprise Solutions, Data Engineering, Quality Assurance,
Product Design, Mobile App Maintenance, Cyber Security, IT Infrastructure, Emerging
Technologies). To reuse this project for a different company, edit that file plus `icons.ts` (a
line-icon glyph per topic) — no other source changes needed.

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

### Image generation and per-platform sizing

Every post's image is a rendered card, not an AI-generated illustration: the Alphazox logo, that
slot's service headline and tagline, its 4 capability bullets, a hand-drawn topic icon, and a
footer with the website/support-email — all pulled directly from `brand.ts` and laid out by
`template.service.ts`. Rendering has two steps, both local and free (no external image API, no
network call, no API key):

1. **Layout** — [Satori](https://github.com/vercel/satori) takes a tree of `div`/`svg` nodes styled
   with a CSS subset (flexbox, gradients, box-shadow, border-radius) and produces an SVG. The two
   fonts it needs (Manrope for text, JetBrains Mono for the footer pills) are bundled as static
   WOFF files under `src/assets/fonts/` — Satori has no access to system or CDN fonts, so the
   bytes have to be supplied up front.
2. **Rasterization** — [`@resvg/resvg-js`](https://github.com/thx/resvg-js) renders that SVG to a
   PNG buffer at the exact pixel dimensions the platform needs.

`IMAGE_DIMENSIONS` in `brand.ts` drives the target size per platform (LinkedIn 1200×627, Twitter
1200×675, Instagram 1080×1080) and which of the two layouts (`landscape` for LinkedIn/Twitter,
`square` for Instagram) gets used, so every image matches that network's real feed aspect ratio
rather than being cropped from one generic shape.

Buffer's `createPost` mutation requires a real, publicly fetchable image URL (its API has no
upload endpoint), so the rendered PNG bytes are uploaded to Cloudinary (`cloudinary.service.ts`,
signed upload via axios + Node's built-in `crypto` — no SDK dependency) for a stable URL before
scheduling. If `CLOUDINARY_*` env vars aren't set: Instagram is skipped entirely for that run (it
cannot post without an image), while LinkedIn and Twitter still go out as text-only rather than
losing the slot. The same graceful fallback applies if rendering itself fails for LinkedIn/Twitter
specifically.

## Environment variables

| Variable                | Required           | Default            | Purpose                                  |
| ----------------------- | ------------------ | ------------------ | ---------------------------------------- |
| `GEMINI_API_KEY`        | yes                | —                  | Google Gemini API key (free tier)        |
| `GEMINI_MODEL`          | no                 | `gemini-2.5-flash` | Gemini model passed to generateContent   |
| `BUFFER_API_KEY`        | yes                | —                  | Buffer GraphQL API key (see note below)  |
| `DATABASE_URL`          | no                 | `file:./dev.db`    | Prisma connection string                 |
| `PORT`                  | no                 | `3000`             | HTTP port for the Express server         |
| `TIMEZONE`              | no                 | `Asia/Kolkata`     | IANA timezone used for scheduling        |
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

**About `CLOUDINARY_*`:** create a free account at
[cloudinary.com](https://cloudinary.com), then copy **Cloud name**, **API
Key**, and **API Secret** from the dashboard into `.env`. No upload preset or
other setup needed — uploads are signed server-side.

## Local setup

```bash
npm install                 # also runs `prisma generate` via postinstall
cp .env.example .env        # then fill in GEMINI_API_KEY and BUFFER_API_KEY
npm run db:push              # creates the SQLite tables
npm run dev                  # starts the API + the hourly cron job
```

Trigger a full generate-and-schedule run manually at any time (useful for testing):

```bash
curl -X POST http://localhost:3000/api/automation/run
```

Or run the same pipeline as a one-shot script (no server, exits when done — this is what CI uses):

```bash
npm run generate:hourly
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
needs no manual database setup), and starts the server with the internal hourly scheduler.
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

`.github/workflows/hourly-automation.yml` runs `npm run generate:hourly` at the top of every hour,
plus on-demand via `workflow_dispatch`. It needs these repository secrets:

- `GEMINI_API_KEY`, `GROQ_API_KEY`
- `BUFFER_API_KEY`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (optional — omit to skip
  Instagram)
- `OPENAI_API_KEY` (optional — omit to fall back to `PEXELS_API_KEY` stock photography)
- `PEXELS_API_KEY` (optional)
- `DATABASE_URL` (optional — omit to use the default SQLite file)

**Persistence note:** GitHub-hosted runners are ephemeral. The workflow caches the SQLite file
between runs as a best-effort way to preserve post history (needed for duplicate detection)
across runs, but a cache can be evicted. For a fully durable production deployment, point
`DATABASE_URL` at a persistent PostgreSQL instance (e.g. Neon, Supabase, Railway) instead — see
"Switching to PostgreSQL" above. In that mode you do not need the internal `node-cron` scheduler
running anywhere; GitHub Actions alone drives the whole pipeline.

If you deploy the server continuously (Docker/VPS) with its own hourly `node-cron` job, disable
the GitHub Actions schedule (or vice versa) to avoid generating and scheduling posts twice in the
same hour.

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
