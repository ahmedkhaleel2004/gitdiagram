import { stdin, stdout, stderr } from "node:process";
import { validateMermaidSyntax } from "../lib/mermaid-validator.ts";

async function readStdin() {
  let data = "";
  for await (const chunk of stdin) {
    data += chunk;
  }
  return data;
}

async function main() {
  try {
    const diagram = (await readStdin()).toString();
    const result = await validateMermaidSyntax(diagram);
    stdout.write(JSON.stringify(result));
  } catch (error) {
    stderr.write(String(error?.message || error));
    process.exit(1);
  }
}
await main();
