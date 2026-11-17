import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { accounts, sessions, users } from "@/db/schema";
import {
  GoogleIdTokenVerifierUnavailableError,
  InvalidGoogleIdTokenError,
  verifyGoogleIdToken,
} from "@/features/mobile-api/google-id-token";
import {
  bodyErrorResponse,
  jsonError,
  mobileApiHeaders,
  readJsonBody,
} from "@/features/mobile-api/http";
import {
  createMobileSessionToken,
  MOBILE_SESSION_DURATION_MS,
} from "@/features/mobile-api/session";

const googleTokenSchema = z
  .object({
    idToken: z.string().min(1).max(12_000),
  })
  .strict();

class ExistingEmailAccountError extends Error {
  constructor() {
    super(
      "This email is already associated with another sign-in identity. Sign in with that identity or contact support.",
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await readJsonBody(request, 16_000);
  } catch (error) {
    const response = bodyErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }

  const parsedBody = googleTokenSchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonError("A valid Google ID token is required.", 400);
  }

  let identity;
  try {
    identity = await verifyGoogleIdToken(parsedBody.data.idToken);
  } catch (error) {
    if (error instanceof InvalidGoogleIdTokenError) {
      return jsonError(error.message, 401);
    }
    if (error instanceof GoogleIdTokenVerifierUnavailableError) {
      return jsonError(error.message, 503);
    }
    throw error;
  }

  const sessionToken = createMobileSessionToken();
  const expires = new Date(Date.now() + MOBILE_SESSION_DURATION_MS);

  let userId: string;
  try {
    userId = await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${identity.subject}))`,
      );

      const [existingAccount] = await transaction
        .select({ userId: accounts.userId })
        .from(accounts)
        .where(
          and(
            eq(accounts.provider, "google"),
            eq(accounts.providerAccountId, identity.subject),
          ),
        )
        .limit(1);

      let resolvedUserId = existingAccount?.userId;

      if (!resolvedUserId) {
        const [existingEmail] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, identity.email))
          .limit(1);

        if (existingEmail) {
          throw new ExistingEmailAccountError();
        }

        const [newUser] = await transaction
          .insert(users)
          .values({
            email: identity.email,
            name: identity.name,
            emailVerified: new Date(),
          })
          .onConflictDoNothing({ target: users.email })
          .returning({ id: users.id });

        if (!newUser) {
          throw new ExistingEmailAccountError();
        }

        resolvedUserId = newUser.id;
        await transaction.insert(accounts).values({
          userId: resolvedUserId,
          type: "oidc",
          provider: "google",
          providerAccountId: identity.subject,
        });
      }

      await transaction.insert(sessions).values({
        sessionToken,
        userId: resolvedUserId,
        expires,
      });

      return resolvedUserId;
    });
  } catch (error) {
    if (error instanceof ExistingEmailAccountError) {
      return jsonError(error.message, 409);
    }
    throw error;
  }

  return Response.json(
    {
      token: sessionToken,
      expiresAt: expires.toISOString(),
      user: {
        id: userId,
        email: identity.email,
        name: identity.name,
      },
    },
    { headers: mobileApiHeaders },
  );
}

