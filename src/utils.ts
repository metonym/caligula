import { createHash } from "crypto";

export function prefixClassName(selector: string) {
  return selector.startsWith(".") ? selector : "." + selector;
}

export function formatSize(bytes: number) {
  if (bytes < 1000) {
    return { value: bytes, unit: "bytes" };
  } else if (bytes >= 1000000) {
    return { value: bytes / 1000000, unit: "MB" };
  } else {
    return { value: bytes / 1000, unit: "kB" };
  }
}

export function getFileSize(bytes: string) {
  const raw = Buffer.byteLength(bytes, "utf8");

  return { ...formatSize(raw), raw };
}

export function getPercDiff(a: number, b: number) {
  const raw = a - b;
  const perc = (100 * raw) / a;

  return { ...formatSize(raw), raw, perc };
}

export function getHash(bytes: string, length: number = 12) {
  return createHash("md5").update(bytes).digest("hex").slice(0, length);
}

export const log = console.log;
