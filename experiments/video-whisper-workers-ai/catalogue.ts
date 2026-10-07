// Lists Workers AI's speech-recognition models with price and schema.
//   bun experiments/video-whisper-workers-ai/catalogue.ts
import { join } from "node:path";
import { cf, DATA, writeJson } from "./lib";

type Schema = {
  type?: string;
  description?: string;
  default?: unknown;
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  anyOf?: Schema[];
  contentType?: string;
};

function show(schema: Schema | undefined, indent = 0) {
  if (!schema) return;
  const pad = " ".repeat(indent);
  for (const key of ["oneOf", "anyOf"] as const)
    for (const option of schema[key] ?? []) {
      console.log(
        `${pad}[${key}] ${option.type ?? ""} ${option.contentType ?? ""}`,
      );
      show(option, indent + 2);
    }
  for (const [name, value] of Object.entries(schema.properties ?? {})) {
    console.log(
      `${pad}${name}: ${value.type ?? ""} ${(value.description ?? "").slice(0, 120)}${value.default === undefined ? "" : ` (default ${JSON.stringify(value.default)})`}`,
    );
    show(value, indent + 2);
    if (value.type === "array") show(value.items, indent + 2);
  }
}

const list = (await (
  await cf(
    "/ai/models/search?task=Automatic%20Speech%20Recognition&per_page=50",
  )
).json()) as {
  result: Array<{
    name: string;
    properties: Array<{ property_id: string; value: unknown }>;
  }>;
};
const out: unknown[] = [];
for (const model of list.result) {
  const schema = (await (
    await cf(`/ai/models/schema?model=${model.name}`)
  ).json()) as { result?: { input: Schema; output: Schema } };
  console.log(`\n== ${model.name}`);
  console.log(JSON.stringify(model.properties));
  console.log("INPUT");
  show(schema.result?.input, 2);
  console.log("OUTPUT");
  show(schema.result?.output, 2);
  out.push({ ...model, schema: schema.result });
}
writeJson(join(DATA, "catalogue.json"), out);
