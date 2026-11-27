import type { PasskeyListResponse } from "../passkeys";

export const passkeysFixture: PasskeyListResponse = {
  passkeys: [
    {
      id: "0192f3c0-0000-7000-8000-0000000000e1",
      createdAt: "2026-11-20T09:30:00+01:00",
      backedUp: true,
    },
    {
      id: "0192f3c0-0000-7000-8000-0000000000e2",
      createdAt: "2026-11-24T19:05:00+01:00",
      backedUp: false,
    },
  ],
};
