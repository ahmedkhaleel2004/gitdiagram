type TaggedValues = Record<string, string | undefined>;

export function toTaggedMessage(values: TaggedValues): string {
  return Object.entries(values)
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => `<${key}>\n${value}\n</${key}>`)
    .join("\n");
}

export function extractTaggedSection(text: string, tag: string): string {
  const startTag = `<${tag}>`;
  const endTag = `</${tag}>`;
  const startIndex = text.indexOf(startTag);
  const endIndex = text.indexOf(endTag);

  if (startIndex === -1 || endIndex === -1) {
    return text.trim();
  }

  return text.slice(startIndex + startTag.length, endIndex).trim();
}
