// Older saved explanations used HTML. Convert their formatting to the small
// Markdown subset our notes renderer supports; never insert HTML into the DOM.
export function architectureText(text: string): string {
  return text
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, level: string, heading: string) =>
        `\n${"#".repeat(Number(level))} ${heading}\n`,
    )
    .replace(/<\/?(?:b|strong)\b[^>]*>/gi, "**")
    .replace(/<\/?code\b[^>]*>/gi, "`")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/?(?:p|div|ul|ol|li)\b[^>]*>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/?(?:i|em|span|a)\b[^>]*>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
