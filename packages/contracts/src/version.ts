import { z } from "zod";

export const calVerSchema = z.string().regex(/^\d{4}\.\d+\.\d+$/);

/** Compares two CalVer strings (`YYYY.N.P`) numerically. Throws on invalid input. */
export function compareCalVer(a: string, b: string): -1 | 0 | 1 {
  const left = calVerSchema.parse(a).split(".").map(Number);
  const right = calVerSchema.parse(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export const versionResponseSchema = z
  .object({ minimumAppVersion: calVerSchema, commit: z.string() })
  .meta({ id: "VersionResponse" });
export type VersionResponse = z.infer<typeof versionResponseSchema>;
