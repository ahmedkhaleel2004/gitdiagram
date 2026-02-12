type TaggedValues = Record<string, string | undefined>;

export function toTaggedMessage(values: TaggedValues): string {
  return Object.entries(values)
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => `<${key}>\n${value}\n</${key}>`)
    .join("\n");
}

export function processClickEvents(
  diagram: string,
  username: string,
  repo: string,
  branch: string,
): string {
  const clickPattern = /click ([^\s"]+)\s+"([^"]+)"/g;

  return diagram.replace(clickPattern, (_, nodeId: string, path: string) => {
    const trimmedPath = path.trim().replace(/^['"]|['"]$/g, "");
    const isFile = trimmedPath.includes(".") && !trimmedPath.endsWith("/");
    const pathType = isFile ? "blob" : "tree";
    const fullUrl = `https://github.com/${username}/${repo}/${pathType}/${branch}/${trimmedPath}`;

    return `click ${nodeId} "${fullUrl}"`;
  });
}

export function extractComponentMapping(response: string): string {
  const startTag = "<component_mapping>";
  const endTag = "</component_mapping>";
  const startIndex = response.indexOf(startTag);
  const endIndex = response.indexOf(endTag);

  if (startIndex === -1 || endIndex === -1) {
    return response;
  }

  return response.slice(startIndex, endIndex);
}

export function stripMermaidCodeFences(text: string): string {
  return text.replace(/```mermaid/g, "").replace(/```/g, "").trim();
}
