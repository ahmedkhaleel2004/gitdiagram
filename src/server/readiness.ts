import { getProvider } from "~/server/generate/model-config";
import {
  getObjectStorageBucket,
  getObjectStorageProvider,
  readRequiredEnv,
} from "~/server/storage/config";
import { checkStorageBucket } from "~/server/storage/r2";
import { checkRedisConnection } from "~/server/storage/upstash";

export interface ReadinessResult {
  ok: boolean;
  checks: {
    configuration: boolean;
    provider: boolean;
    publicStorage: boolean;
    privateStorage: boolean;
    redis: boolean;
  };
}

function hasProviderKey(): boolean {
  const provider = getProvider();
  const keyName =
    provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
  return Boolean(process.env[keyName]?.trim());
}

export async function checkReadiness(): Promise<ReadinessResult> {
  let publicBucket = "";
  let privateBucket = "";
  let configuration = true;
  try {
    publicBucket = getObjectStorageBucket("public");
    privateBucket = getObjectStorageBucket("private");
    if (getObjectStorageProvider() !== "gcs") {
      readRequiredEnv("R2_ACCOUNT_ID");
      readRequiredEnv("R2_ACCESS_KEY_ID");
      readRequiredEnv("R2_SECRET_ACCESS_KEY");
    }
    if (!process.env.REDIS_URL?.trim()) {
      readRequiredEnv("UPSTASH_REDIS_REST_URL");
      readRequiredEnv("UPSTASH_REDIS_REST_TOKEN");
    }
    readRequiredEnv("CACHE_KEY_SECRET");
  } catch {
    configuration = false;
  }

  const provider = hasProviderKey();
  const [publicStorageResult, privateStorageResult, redisResult] = configuration
    ? await Promise.allSettled([
        checkStorageBucket(publicBucket),
        checkStorageBucket(privateBucket),
        checkRedisConnection(),
      ])
    : [
        { status: "rejected" as const },
        { status: "rejected" as const },
        { status: "rejected" as const },
      ];

  const checks = {
    configuration,
    provider,
    publicStorage: publicStorageResult.status === "fulfilled",
    privateStorage: privateStorageResult.status === "fulfilled",
    redis: redisResult.status === "fulfilled",
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
  };
}
