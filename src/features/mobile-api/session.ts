import { and, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import { sessions } from "@/db/schema";
import { getBearerToken } from "./bearer-token";

export { createMobileSessionToken, getBearerToken } from "./bearer-token";

export const MOBILE_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export async function getMobileUserId(
  request: Request,
): Promise<string | undefined> {
  const token = getBearerToken(request);
  if (!token) {
    return undefined;
  }

  const [session] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionToken, token),
        gt(sessions.expires, new Date()),
      ),
    )
    .limit(1);

  return session?.userId;
}
