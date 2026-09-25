// Serves public/ so headless Chromium can load the video stage.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const root = resolve(process.cwd(), process.env.STAGE_ROOT ?? "public");
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

createServer(async (request, response) => {
  const path = decodeURIComponent(
    new URL(request.url ?? "/", "http://x").pathname,
  );
  try {
    // Experiment pictures live with the experiment output.
    const body = path.startsWith("/exp-images/")
      ? await readFile(
          join(
            process.cwd(),
            "experiments/video-bespoke/out/images",
            path.slice(12),
          ),
        )
      : await readFile(join(root, path));
    response.writeHead(200, {
      "content-type": types[extname(path)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(Number(process.env.PORT ?? 4599), "127.0.0.1", () =>
  console.info(`stage server on ${process.env.PORT ?? 4599}`),
);
