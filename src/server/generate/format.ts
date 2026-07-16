type TaggedValues = Record<string, string | undefined>;

export function toTaggedMessage(values: TaggedValues): string {
  const sections: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") {
      sections.push(`<${key}>\n${value}\n</${key}>`);
    }
  }
  return sections.join("\n");
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
