import { isPhoneScreen } from "@padvinder/ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST = "/app/more/membership-requests";

/**
 * The app's address for a requests link opened in the portal, or null. Only on a phone; an
 * `request` that is not a UUID is left out.
 */
export function appAddressFor(
  location: { pathname: string; search: string },
  phone: boolean,
): string | null {
  if (!phone || location.pathname.replace(/\/$/, "") !== "/membership-requests") return null;
  const id = new URLSearchParams(location.search).get("request");
  return id && UUID.test(id) ? `${LIST}/${id}` : LIST;
}

/** The full address to send this browser to, or null to stay in the portal. */
export function appUrlForThisBrowser(): string | null {
  const path = appAddressFor(window.location, isPhoneScreen(window.screen));
  if (path === null) return null;
  // Under the dev servers the app has its own port on the same host; in a build, one origin.
  return __APP_DEV_PORT__ === null
    ? path
    : `${window.location.protocol}//${window.location.hostname}:${__APP_DEV_PORT__}${path}`;
}
