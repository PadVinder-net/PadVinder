import type { Page } from "@playwright/test";

/**
 * Gives the page a virtual authenticator through Chromium's DevTools protocol: a platform
 * authenticator that keeps discoverable passkeys, always verifies the user (as a fingerprint
 * would) and answers every prompt by itself. It works on http://localhost, which browsers treat
 * as a secure context. Each page has its own: a passkey made on one is unknown to another.
 */
export async function addVirtualAuthenticator(page: Page): Promise<{ remove(): Promise<void> }> {
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable");
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    async remove() {
      await session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
      await session.detach();
    },
  };
}
