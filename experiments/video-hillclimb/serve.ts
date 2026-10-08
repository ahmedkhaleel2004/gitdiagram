// Serves public/ (the video stage); /api/video/file is passed to production
// so stored films show their README pictures, and /exp-images/ serves this
// experiment's own pictures.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";

const root = resolve(process.cwd(), "public");
const images = resolve(process.cwd(), "experiments/video-hillclimb/out/images");
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
  const url = new URL(request.url ?? "/", "http://x");
  const path = decodeURIComponent(url.pathname);
  try {
    if (path === "/api/video/file") {
      const upstream = await fetch(
        `https://gitdiagram.com${url.pathname}${url.search}`,
      );
      response.writeHead(upstream.status, {
        "content-type":
          upstream.headers.get("content-type") ?? "application/octet-stream",
      });
      response.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    const file = path.startsWith("/exp-images/")
      ? resolve(images, path.slice(12))
      : resolve(root, `.${path}`);
    if (!file.startsWith(root) && !file.startsWith(images))
      throw new Error("outside");
    response.writeHead(200, {
      "content-type": types[extname(path)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(Number(process.env.PORT ?? 4611), "127.0.0.1", () =>
  console.info(`stage server on ${process.env.PORT ?? 4611}`),
);
