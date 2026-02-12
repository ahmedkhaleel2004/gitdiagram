const DEFAULT_MODEL = "gpt-5.2";

function readEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getModel(): string {
  return readEnvValue("OPENAI_MODEL") ?? DEFAULT_MODEL;
}
