import type { PlatformAdmin } from "../platform-admins";
import { meFixture } from "./me";

/**
 * Three platform admins in the order the API gives them (by name in Dutch order): one who never
 * logged in and has no name yet, `meFixture`'s user, and one more.
 */
export const platformAdminsFixture: PlatformAdmin[] = [
  {
    userId: "0192f3c0-0000-7000-8000-0000000000d2",
    name: "",
    email: "nieuwe-hoofdbeheerder@example.test",
    hasLoggedIn: false,
    hasPasskey: false,
  },
  {
    userId: meFixture.user.id,
    name: meFixture.user.name,
    email: meFixture.user.email,
    hasLoggedIn: true,
    hasPasskey: true,
  },
  {
    userId: "0192f3c0-0000-7000-8000-0000000000d1",
    name: "Pieter Jansen",
    email: "pieter@example.test",
    hasLoggedIn: true,
    hasPasskey: true,
  },
];
