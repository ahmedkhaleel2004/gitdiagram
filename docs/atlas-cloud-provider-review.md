# Atlas Cloud Provider Review

## Summary

This change adds Atlas Cloud as a first-class provider for GitDiagram's Next.js and FastAPI generation runtimes.

## What Changed

- Added `atlas` to the shared provider model config in:
  - `src/server/generate/model-config.ts`
  - `backend/app/services/model_config.py`
- Added Atlas Cloud environment variables in `.env.example`:
  - `ATLAS_API_KEY`
  - `ATLAS_MODEL`
  - `ATLAS_BASE_URL`
- Implemented Atlas-specific request handling in:
  - `src/server/generate/openai.ts`
  - `backend/app/services/openai_service.py`
- Kept OpenAI/OpenRouter behavior unchanged.

## Atlas Runtime Behavior

- Atlas Cloud uses the OpenAI-compatible `chat/completions` API instead of the OpenAI `responses` API.
- Streaming text generation now works through Atlas with the OpenAI SDK configured to:
  - `baseURL=https://api.atlascloud.ai/v1`
- Structured graph generation for Atlas uses:
  - chat completions
  - `response_format: { type: "json_object" }`
  - local schema validation after the model response returns
- Exact input token counting remains disabled for Atlas and falls back to the existing conservative local estimator.

## Default Model

- Initial docs-style model `deepseek-v3` returned `{"code":400,"msg":"not found"}` during live verification.
- Updated the default Atlas model to the verified model id:
  - `deepseek-ai/DeepSeek-V3-0324`

## Pricing

- Added Atlas pricing mapping for `deepseek-v3-0324` in:
  - `src/server/generate/pricing.ts`
  - `backend/app/services/pricing.py`
- Pricing used:
  - input: `$0.216 / 1M`
  - output: `$0.88 / 1M`

## README Updates

- Added Atlas Cloud to the provider documentation in `README.md`
- Added the required official link with tracking:
  - `https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=gitdiagram`
- Added Atlas self-hosting environment examples.

## Tests Added

- `src/server/generate/model-config.test.ts`
- `backend/tests/test_model_config.py`
- `backend/tests/test_openai_service.py`
- Extended pricing tests in both runtimes.

## Verification

- Frontend tests: `72 passed`
- Backend tests: `31 passed`
- TypeScript typecheck: passed
- Live Atlas direct API check:
  - `deepseek-ai/DeepSeek-V3-0324` returned `200`
- Live in-app Atlas generation check:
  - explanation streaming worked
  - graph JSON generation worked
  - Mermaid compilation worked

## Remaining Local Env Limitation

- The in-app generation flow reached the final persistence step and then failed because local storage env vars are not configured:
  - `Missing R2_PUBLIC_BUCKET.`
- This is an existing local deployment/storage configuration issue, not an Atlas provider integration failure.
