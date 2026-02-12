import { z } from "zod";

export const generateRequestSchema = z.object({
  username: z.string().min(1),
  repo: z.string().min(1),
  api_key: z.string().min(1).optional(),
  github_pat: z.string().min(1).optional(),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export function sseMessage(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
