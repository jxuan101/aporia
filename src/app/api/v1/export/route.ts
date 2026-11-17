import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { captures } from "@/db/schema";
import { createCaptureExport } from "@/features/capture/export";
import { jsonError, mobileApiHeaders } from "@/features/mobile-api/http";
import { getMobileUserId } from "@/features/mobile-api/session";

export async function GET(request: Request): Promise<Response> {
  const userId = await getMobileUserId(request);
  if (!userId) {
    return jsonError("Authentication required.", 401);
  }

  const userCaptures = await db
    .select({
      id: captures.id,
      originalText: captures.rawText,
      currentText: captures.currentText,
      createdAt: captures.createdAt,
      updatedAt: captures.updatedAt,
    })
    .from(captures)
    .where(eq(captures.userId, userId))
    .orderBy(desc(captures.createdAt), desc(captures.id));

  return Response.json(createCaptureExport(userCaptures, new Date()), {
    headers: {
      ...mobileApiHeaders,
      "Content-Disposition": 'attachment; filename="braindump-export.json"',
    },
  });
}
