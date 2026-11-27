import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

/**
 * A passkey in software, for tests: what a phone or laptop does when the browser asks it to make
 * or use a passkey. One P-256 key pair, a `"none"` attestation, ES256 signatures.
 */
export type SoftAuthenticator = {
  /** The credential ID (base64url), as the server stores it. */
  readonly credentialId: string;
  /** Whether the next ceremony reports user verification (a fingerprint, face or PIN). */
  userVerified: boolean;
  register(optionsJSON: PublicKeyCredentialCreationOptionsJSON): RegistrationResponseJSON;
  authenticate(optionsJSON: PublicKeyCredentialRequestOptionsJSON): AuthenticationResponseJSON;
};

type Bytes = Uint8Array<ArrayBuffer>;

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

const sha256 = (data: Bytes): Bytes => new Uint8Array(createHash("sha256").update(data).digest());
const utf8 = (text: string): Bytes => new TextEncoder().encode(text);

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function uint32(value: number): Bytes {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function uint16(value: number): Bytes {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

/** The public key as a COSE EC2 key (kty 2, alg ES256, crv P-256). */
function coseKey(publicKey: KeyObject): Bytes {
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("Not an EC key");
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x)],
      [-3, isoBase64URL.toBuffer(jwk.y)],
    ]),
  );
}

export function createSoftAuthenticator(input: {
  origin: string;
  userVerified?: boolean;
}): SoftAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const rawId = new Uint8Array(randomBytes(32));
  const credentialId = isoBase64URL.fromBuffer(rawId);
  let counter = 0;
  let userHandle: string | undefined;

  const clientData = (type: "webauthn.create" | "webauthn.get", challenge: string) =>
    utf8(JSON.stringify({ type, challenge, origin: input.origin, crossOrigin: false }));

  const authenticatorData = (rpId: string, attested: Bytes | null, flagsUserVerified: boolean) =>
    concat(
      sha256(utf8(rpId)),
      new Uint8Array([
        FLAG_USER_PRESENT |
          (flagsUserVerified ? FLAG_USER_VERIFIED : 0) |
          (attested ? FLAG_ATTESTED_CREDENTIAL : 0),
      ]),
      uint32(counter),
      attested ?? new Uint8Array(),
    );

  const authenticator: SoftAuthenticator = {
    credentialId,
    userVerified: input.userVerified ?? true,
    register(options) {
      userHandle = options.user.id;
      const attested = concat(
        new Uint8Array(16), // AAGUID: all zeros, as many platforms report
        uint16(rawId.length),
        rawId,
        coseKey(publicKey),
      );
      const authData = authenticatorData(options.rp.id ?? "", attested, authenticator.userVerified);
      const attestationObject = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<never, never>>([
          ["fmt", "none"],
          ["attStmt", new Map<never, never>()],
          ["authData", authData],
        ]),
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(clientData("webauthn.create", options.challenge)),
          attestationObject: isoBase64URL.fromBuffer(attestationObject),
          transports: ["internal"],
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
    authenticate(options) {
      counter += 1;
      const authData = authenticatorData(options.rpId ?? "", null, authenticator.userVerified);
      const clientDataJSON = clientData("webauthn.get", options.challenge);
      const signature = sign("sha256", concat(authData, sha256(clientDataJSON)), privateKey);
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
          authenticatorData: isoBase64URL.fromBuffer(authData),
          signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
          ...(userHandle !== undefined && { userHandle }),
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
  };
  return authenticator;
}
