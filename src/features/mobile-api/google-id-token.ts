import { errors, createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 5_000 },
);

const googleIdentitySchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.literal(true),
  name: z.string().optional(),
});

export type GoogleIdentity = {
  subject: string;
  email: string;
  name: string | null;
};

export class InvalidGoogleIdTokenError extends Error {
  constructor() {
    super("The Google sign-in token is invalid or expired.");
  }
}

export class GoogleIdTokenVerifierUnavailableError extends Error {
  constructor() {
    super("Google sign-in verification is temporarily unavailable.");
  }
}

export async function verifyGoogleIdToken(
  idToken: string,
): Promise<GoogleIdentity> {
  const audience = process.env.AUTH_GOOGLE_ID;
  if (!audience) {
    throw new Error("AUTH_GOOGLE_ID must be configured for mobile sign-in.");
  }

  let payload: unknown;
  try {
    const result = await jwtVerify(idToken, googleKeys, {
      algorithms: ["RS256"],
      audience,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });
    payload = result.payload;
  } catch (error) {
    if (
      error instanceof errors.JWTClaimValidationFailed ||
      error instanceof errors.JWTExpired ||
      error instanceof errors.JWTInvalid ||
      error instanceof errors.JWSInvalid ||
      error instanceof errors.JWKSNoMatchingKey ||
      error instanceof errors.JWSSignatureVerificationFailed
    ) {
      throw new InvalidGoogleIdTokenError();
    }

    if (
      error instanceof errors.JWKSTimeout ||
      error instanceof errors.JWKSInvalid ||
      error instanceof TypeError
    ) {
      throw new GoogleIdTokenVerifierUnavailableError();
    }

    throw error;
  }

  const identity = googleIdentitySchema.safeParse(payload);
  if (!identity.success) {
    throw new InvalidGoogleIdTokenError();
  }

  return {
    subject: identity.data.sub,
    email: identity.data.email,
    name: identity.data.name ?? null,
  };
}
