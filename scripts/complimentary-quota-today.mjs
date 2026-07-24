import { config } from "dotenv";
import {
  getComplimentaryDailyLimitTokens,
  getComplimentaryQuotaBucket,
} from "../src/server/generate/complimentary-gate";
import {
  buildQuotaKey,
  buildQuotaLeaseKey,
} from "../src/server/storage/quota-store";
import { upstashCommand } from "../src/server/storage/upstash";

config({ path: ".env" });

const tokenLimit = getComplimentaryDailyLimitTokens();
const quotaDateUtc = new Date().toISOString().slice(0, 10);
const quotaBucket = getComplimentaryQuotaBucket();
const nowMs = Date.now();

const result = await upstashCommand([
  "HMGET",
  buildQuotaKey(quotaDateUtc, quotaBucket),
  "used_tokens",
  "reserved_tokens",
]);

const leaseKey = buildQuotaLeaseKey(quotaDateUtc, quotaBucket);
const [liveLeases, staleLeases] = await Promise.all([
  upstashCommand(["ZCOUNT", leaseKey, String(nowMs), "+inf"]),
  upstashCommand(["ZCOUNT", leaseKey, "-inf", String(nowMs)]),
]);

const usedTokens = Number.parseInt(result?.[0] ?? "0", 10) || 0;
const reservedTokens = Number.parseInt(result?.[1] ?? "0", 10) || 0;
const remainingTokens = Math.max(tokenLimit - usedTokens - reservedTokens, 0);

console.log("Backend:         upstash");
console.log(`UTC date:        ${quotaDateUtc}`);
console.log(`Bucket:          ${quotaBucket}`);
console.log(`Daily limit:     ${tokenLimit.toLocaleString()}`);
console.log(`Used exact:      ${usedTokens.toLocaleString()}`);
console.log(`Reserved now:    ${reservedTokens.toLocaleString()}`);
console.log(`Available now:   ${remainingTokens.toLocaleString()}`);
console.log(`Live leases:     ${Number(liveLeases ?? 0).toLocaleString()}`);
// Stale leases are reclaimed by the next admission; a non-zero count here just
// means no generation has started since they expired.
console.log(`Stale leases:    ${Number(staleLeases ?? 0).toLocaleString()}`);
