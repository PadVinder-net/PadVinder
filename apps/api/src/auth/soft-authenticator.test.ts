import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { expect, test } from "vitest";
import { createSoftAuthenticator } from "../testing/soft-authenticator";

const origin = "http://localhost:4101";
const rpID = "localhost";

async function register(userVerified = true) {
  const authenticator = createSoftAuthenticator({ origin, userVerified });
  const options = await generateRegistrationOptions({
    rpName: "PadVinder",
    rpID,
    userName: "noor@example.test",
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const response = authenticator.register(options);
  return { authenticator, options, response };
}

test("its registration and assertion pass SimpleWebAuthn's verify functions", async () => {
  const { authenticator, options, response } = await register();
  expect(response.id).toBe(authenticator.credentialId);
  const registration = await verifyRegistrationResponse({
    response,
    expectedChallenge: options.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  expect(registration.verified).toBe(true);
  const credential = registration.registrationInfo!.credential;
  expect(credential.id).toBe(authenticator.credentialId);

  for (let i = 0; i < 2; i++) {
    const request = await generateAuthenticationOptions({ rpID, userVerification: "required" });
    const assertion = authenticator.authenticate(request);
    expect(assertion.response.userHandle).toBe(options.user.id);
    const verified = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: request.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential,
      requireUserVerification: true,
    });
    expect(verified.verified).toBe(true);
    credential.counter = verified.authenticationInfo.newCounter;
  }
});

test("without user verification its assertion is refused where verification is required", async () => {
  const { authenticator, options, response } = await register();
  const { registrationInfo } = await verifyRegistrationResponse({
    response,
    expectedChallenge: options.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
  authenticator.userVerified = false;
  const request = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  await expect(
    verifyAuthenticationResponse({
      response: authenticator.authenticate(request),
      expectedChallenge: request.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: registrationInfo!.credential,
      requireUserVerification: true,
    }),
  ).rejects.toThrow(/user verification/i);
});
