import { isPhoneScreen, isUuid } from "@padvinder/ui";

const REQUESTS = /^\/app\/more\/membership-requests(?:\/([^/]+))?\/?$/;

/**
 * The portal's address for a request link opened in the app, or null. Only on a screen that is not
 * a phone; the address holds nothing but a UUID.
 */
export function portalAddressFor(location: { pathname: string }, phone: boolean): string | null {
  if (phone) return null;
  const match = REQUESTS.exec(location.pathname);
  if (!match) return null;
  const id = match[1];
  return id && isUuid(id)
    ? `/membership-requests?request=${id.toLowerCase()}`
    : "/membership-requests";
}

/** The full address to send this browser to, or null to stay in the app. */
export function portalUrlForThisBrowser(): string | null {
  const path = portalAddressFor(window.location, isPhoneScreen(window.screen));
  if (path === null) return null;
  // Under the dev servers the portal has its own port on the same host; in a build, one origin.
  return __PORTAL_DEV_PORT__ === null
    ? path
    : `${window.location.protocol}//${window.location.hostname}:${__PORTAL_DEV_PORT__}${path}`;
}
