// Serves public/ (the video stage) and this experiment's README pictures.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const root = resolve(process.cwd(), "public");
const images = resolve(
  process.cwd(),
  "experiments/video-haiku-designer/out/images",
);
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpeg": "image/jpeg",
};

createServer(async (request, response) => {
  const path = decodeURIComponent(
    new URL(request.url ?? "/", "http://x").pathname,
  );
  try {
    const file = path.startsWith("/exp-images/")
      ? resolve(images, path.slice(12))
      : resolve(root, `.${path}`);
    if (!file.startsWith(root) && !file.startsWith(images))
      throw new Error("outside");
    response.writeHead(200, {
      "content-type": types[extname(path)] ?? "application/octet-stream",
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(Number(process.env.PORT ?? 4599), "127.0.0.1", () =>
  console.info(`stage server on ${process.env.PORT ?? 4599}`),
);
