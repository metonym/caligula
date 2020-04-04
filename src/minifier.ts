import { process } from "cssnano";
import { getFileSize } from "./utils";

export async function minifier(source: string, options: any) {
  const result = await process(source, options);

  return { ...getFileSize(result.css), css: result.css };
}
