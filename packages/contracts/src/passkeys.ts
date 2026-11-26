import { z } from "zod";

/** One of the logged-in admin's own passkeys. Never holds key material. */
export const passkeySchema = z
  .object({
    id: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
    /** Whether the passkey is synced to the person's cloud account. */
    backedUp: z.boolean(),
  })
  .meta({ id: "Passkey" });
export type Passkey = z.infer<typeof passkeySchema>;

export const passkeyListResponseSchema = z
  .object({ passkeys: z.array(passkeySchema) })
  .meta({ id: "PasskeyListResponse" });
export type PasskeyListResponse = z.infer<typeof passkeyListResponseSchema>;
