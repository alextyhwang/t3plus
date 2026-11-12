// Serves the visual harness on 127.0.0.1. Run `npm run build` first.
//   node harness/serve.mjs [port]
// Any path that is not a file returns harness/index.html, so
// /settings/appearance exercises the same route check as T3.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.argv[2] ?? 4378);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = join(root, path);
  const allowed = file.startsWith(join(root, "dist") + sep) || file.startsWith(join(root, "harness") + sep);
  try {
    if (!allowed) throw new Error("fallback");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(await readFile(join(root, "harness/index.html")));
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`t3+ harness: http://127.0.0.1:${port}/settings/appearance`);
});
