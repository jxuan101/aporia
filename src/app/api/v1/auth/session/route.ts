import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sessions } from "@/db/schema";
import { jsonError } from "@/features/mobile-api/http";
import { getBearerToken } from "@/features/mobile-api/session";

export async function DELETE(request: Request): Promise<Response> {
  const sessionToken = getBearerToken(request);
  if (!sessionToken) {
    return jsonError("Authentication required.", 401);
  }

  await db
    .delete(sessions)
    .where(eq(sessions.sessionToken, sessionToken));

  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
