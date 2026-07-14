# Atlas Cloud provider review

## Summary

Atlas Cloud is a first-class provider in GitDiagram's Vercel-native generation runtime.

## Implementation

- Provider and model selection: `src/server/generate/model-config.ts`
- Validated model catalog: `src/server/generate/atlas-models.ts`
- Streaming and structured requests: `src/server/generate/openai.ts`
- Pricing lookup: `src/server/generate/pricing.ts`
- Environment template: `.env.example`

Atlas uses its OpenAI-compatible `chat/completions` endpoint:

```dotenv
AI_PROVIDER=atlas
ATLAS_API_KEY=...
ATLAS_MODEL=deepseek-ai/DeepSeek-V3-0324
ATLAS_BASE_URL=https://api.atlascloud.ai/v1
```

The default verified model is `deepseek-ai/DeepSeek-V3-0324`.

## Runtime behavior

- Explanation generation streams through chat completions.
- Graph generation requests a JSON object and then validates it locally with the same strict graph schema used for every provider.
- Invalid graph output receives focused validation feedback and may be retried.
- Exact provider token counting is unavailable, so estimates use the conservative local token estimator.
- Request cancellation, deadlines, quota accounting, deterministic Mermaid compilation, and persistence are provider-independent.

## Pricing

The current local pricing entry for `deepseek-v3-0324` is:

- Input: `$0.216 / 1M tokens`
- Output: `$0.88 / 1M tokens`

Provider pricing can change. Update `src/server/generate/pricing.ts` when Atlas changes its public rates.

## Verification

Run the current provider, pricing, compiler, and route tests instead of relying on historical test counts:

```bash
bun run test
bun run typecheck
bun run build
```

Live provider verification should confirm explanation streaming, strict graph JSON, deterministic Mermaid compilation, and final R2/Upstash persistence with a fully configured environment.
