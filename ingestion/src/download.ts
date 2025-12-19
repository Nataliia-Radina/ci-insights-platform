import fs from "node:fs";
import { pipeline, Readable } from "node:stream";
import { promisify } from "node:util";

const streamPipeline = promisify(pipeline);

export async function downloadToFile(url: string, outPath: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  // Avoid `as any` on pipeline input by converting Web stream -> Node stream
  const nodeStream = Readable.fromWeb(res.body as any);
  await streamPipeline(nodeStream, fs.createWriteStream(outPath));
}