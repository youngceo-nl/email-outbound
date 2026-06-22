import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export type StaticAssetServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

/**
 * Remotion's <Img>/<Video> are loaded via the browser DOM, which refuses
 * file:// resources even with web security disabled — only <Audio> goes
 * through Node-side asset extraction. Per-job generated assets (screenshots,
 * TTS audio, rendered clips) therefore need to be served over plain HTTP for
 * the duration of a render. See remotion/src/types.ts (toMediaSrc).
 */
export async function startStaticAssetServer(rootDir: string): Promise<StaticAssetServer> {
  const server: Server = createServer(async (req, res) => {
    try {
      const requestPath = decodeURIComponent((req.url ?? "").split("?")[0]);
      const absoluteRoot = path.resolve(rootDir);
      const filePath = path.resolve(absoluteRoot, `.${requestPath}`);
      if (!filePath.startsWith(absoluteRoot)) throw new Error("path traversal");
      const body = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("static asset server failed to bind");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
