// Serves public/ so headless Chromium can load the video stage.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const root = join(process.cwd(), "public");
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const path = decodeURIComponent(
    new URL(request.url ?? "/", "http://x").pathname,
  );
  try {
    const body = await readFile(join(root, path));
    response.writeHead(200, {
      "content-type": types[extname(path)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(4599, "127.0.0.1", () =>
  console.info("stage server on http://127.0.0.1:4599"),
);
