# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an image generation agent service built with the Mastra framework, deployed on Cloudflare Workers. It uses Google Gemini 2.5 Flash Image for AI image generation and Cloudflare R2 for cloud storage.

**Core Functionality**: Accept image generation requests via API, generate images using Google Gemini, store them in Cloudflare R2, and return public URLs.

## Development Commands

### Local Development
```bash
# Start Mastra development server (port 4111, includes playground)
npm run dev:mastra

# Start Cloudflare Workers local development (port 8787)
npm run dev

# Build TypeScript
npm run build
```

### Testing
```bash
# Test the API endpoint
npm run test:api

# Test R2 upload functionality
npm run test:r2

# Check environment variables
npm run check:env
```

### Deployment
```bash
# Create R2 bucket
npm run deploy:r2

# Deploy to Cloudflare Workers
npm run deploy

# View deployment logs
npm run logs
# Or: wrangler tail
```

### Secrets Management
```bash
# Set API keys as secrets (production)
wrangler secret put GOOGLE_API_KEY
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID

# List configured secrets
wrangler secret list
```

## Architecture

### Deployment Models

This project supports **two deployment modes**:

1. **Mastra Dev Server** (`npm run dev:mastra`): Local development with Mastra playground UI at http://localhost:4111
2. **Cloudflare Workers** (`npm run dev` or `npm run deploy`): Serverless deployment for production

### Key Components

**Entry Points**:
- `workers/index.ts`: Cloudflare Workers entry using Hono framework
- `src/mastra/index.ts`: Mastra framework configuration

**Agent Layer** (`src/mastra/agents/`):
- `image-agent.ts`: Main AI agent using Gemini 2.0 Flash as the reasoning LLM
  - Handles prompt optimization and user interaction
  - Calls `smartImageRouterTool` to generate images
  - Uses LibSQL for memory storage

**Tool Layer** (`src/mastra/tools/`):
- `smart-image-router.ts`: Core image generation tool
  - Uses Google Gemini 2.5 Flash Image model for generation
  - Supports 1-4 images per request (MAX_IMAGES_PER_REQUEST = 4)
  - Auto-uploads to R2 if configured, falls back to local storage
  - Saves local backups to `output/` directory

**API Layer** (`src/api/routes.ts`):
- Registered routes using Mastra's `registerApiRoute`:
  - `GET /health`: Health check
  - `POST /generate-image`: Main image generation endpoint
  - `POST /generate-batch`: Batch generation (not implemented)
  - `GET /task/:taskId`: Task status query (not implemented)

**Storage Layer**:
- `src/utils/r2-storage.ts`: R2 operations for Cloudflare Workers (using R2Bucket binding)
- `src/utils/r2-uploader.ts`: R2 operations for local dev (using S3 SDK)

### Data Flow

1. Request → `POST /api/generate-image` (routes.ts)
2. Validation → Check task_id, prompt, count (1-5)
3. Tool execution → `smartImageRouterTool.execute()` generates images
4. Image generation → Google Gemini 2.5 Flash Image API
5. Storage → Upload to R2 + save local backup
6. Response → Return public R2 URLs or local paths

### Environment Variables

**Required for Image Generation**:
- `GOOGLE_API_KEY`: Google Gemini API key (used by both agent LLM and image generation)

**R2 Storage (optional but recommended)**:
- For Workers deployment: R2 bucket binding in `wrangler.toml`
- For local dev: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_DOMAIN`

**R2 Configuration**:
- `R2_PUBLIC_URL` in `wrangler.toml` (for Workers)
- `R2_PUBLIC_DOMAIN` in `.env` (for local dev)

If R2 is not configured, the service falls back to local storage mode and saves images to `output/`.

### Storage Strategy

**Dual Storage Approach**:
1. **Local Backup**: Always saves to `output/` directory
2. **Cloud Storage**: Uploads to R2 if configured
   - Workers: Uses R2Bucket binding (r2-storage.ts)
   - Local: Uses S3 SDK (r2-uploader.ts)

**R2 Path Structure**: `images/{task_id}/{timestamp}_{index}.png`

## Key Implementation Details

### Image Generation Models
- **Agent LLM**: Gemini 2.0 Flash (for reasoning and prompt optimization)
- **Image Generation**: Gemini 2.5 Flash Image (constant: `GOOGLE_GEMINI_IMAGE_MODEL`)
- Both use the same `GOOGLE_API_KEY`

### Request Limits
- Count range: 1-5 images per request (API validation)
- Max images per generation call: 4 (MAX_IMAGES_PER_REQUEST in smart-image-router.ts)
- For count > 4, the tool loops multiple times

### R2 Storage Details
- Workers use R2Bucket binding (`env.IMAGE_STORAGE`)
- Local dev uses S3 SDK with R2 endpoints
- Files stored with metadata: taskId, uploadedAt, originalIndex
- Cache-Control: 1 year (`max-age=31536000`)

### Error Handling
- Quota errors (429): Suggests waiting or using different API key
- Token limit errors: Suggests refreshing conversation
- R2 errors: Falls back to local storage mode

## Common Development Patterns

### Adding a New API Route
1. Create route in `src/api/routes.ts` using `registerApiRoute`
2. Add route to `routes` array export
3. Route is automatically available at Mastra server

### Testing Image Generation Locally
```bash
# Start Mastra dev server
npm run dev:mastra

# In another terminal, test the API
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "test_001",
    "prompt": "A cute cat in space",
    "count": 1
  }'
```

### Debugging R2 Upload Issues
1. Check R2 configuration: `npm run check:env`
2. Test R2 upload: `npm run test:r2`
3. Check logs for specific error messages
4. Verify R2_PUBLIC_URL/R2_PUBLIC_DOMAIN matches your bucket's public access URL

### Working with the Agent
- Agent instructions are in `src/mastra/agents/image-agent.ts`
- Agent expects English prompts for best results
- Agent uses memory (LibSQL) to maintain conversation context
- Access agent playground at http://localhost:4111 when running `dev:mastra`

## Cloudflare Workers Specifics

### wrangler.toml Configuration
- `compatibility_flags = ["nodejs_compat"]`: Required for Node.js APIs
- R2 binding: `IMAGE_STORAGE` → `image-agent-storage` bucket
- Development environment uses separate bucket: `image-agent-storage-dev`

### Workers Limitations
- CPU time limits (free: 10ms, paid: up to 30s)
- For multiple images, consider async webhook pattern (not yet implemented)
- CORS is configured in `workers/index.ts`

## Type Definitions

Located in `src/types/index.ts`:
- `Env`: Cloudflare Workers environment bindings
- `GenerateImageRequest/Response`: API contract
- `ThirdPartyAIRequest/Response`: For webhook integration (planned)

## Important Notes

- **Never commit `.env` or `.dev.vars`** - they contain API keys
- **Local backups**: All images are saved to `output/` regardless of R2 status
- **File naming**: `gemini_{timestamp}_{index}.png` for local files
- **R2 lifecycle**: Configure 30-day expiration rules in Cloudflare Dashboard (see DEPLOYMENT.md)
- **Agent memory**: Stored in `mastra.db` (LibSQL) - not committed to git
- **Weather agent/workflow**: Exists in codebase but not used for image generation
