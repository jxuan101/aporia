import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { captures } from "@/db/schema";
import { captureIdSchema, captureTextSchema } from "@/features/capture/validation";
import {
  bodyErrorResponse,
  jsonError,
  mobileApiHeaders,
  readJsonBody,
} from "@/features/mobile-api/http";
import { serializeCapture } from "@/features/mobile-api/captures";
import { getMobileUserId } from "@/features/mobile-api/session";

type CaptureRouteContext = {
  params: Promise<{ id: string }>;
};

const captureBodySchema = z.object({ text: captureTextSchema }).strict();

export async function PATCH(
  request: Request,
  context: CaptureRouteContext,
): Promise<Response> {
  const userId = await getMobileUserId(request);
  if (!userId) {
    return jsonError("Authentication required.", 401);
  }

  const { id } = await context.params;
  const idResult = captureIdSchema.safeParse(id);
  if (!idResult.success) {
    return jsonError("The capture is unavailable.", 404);
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    const response = bodyErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }

  const parsedBody = captureBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonError("Enter a thought of up to 10,000 characters.", 400);
  }

  const [capture] = await db
    .update(captures)
    .set({
      currentText: parsedBody.data.text,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(captures.id, idResult.data),
        eq(captures.userId, userId),
      ),
    )
    .returning();

  if (!capture) {
    return jsonError("The capture is unavailable.", 404);
  }

  return Response.json(
    { capture: serializeCapture(capture) },
    { headers: mobileApiHeaders },
  );
}

export async function DELETE(
  request: Request,
  context: CaptureRouteContext,
): Promise<Response> {
  const userId = await getMobileUserId(request);
  if (!userId) {
    return jsonError("Authentication required.", 401);
  }

  const { id } = await context.params;
  const idResult = captureIdSchema.safeParse(id);
  if (!idResult.success) {
    return jsonError("The capture is unavailable.", 404);
  }

  const [deletedCapture] = await db
    .delete(captures)
    .where(
      and(
        eq(captures.id, idResult.data),
        eq(captures.userId, userId),
      ),
    )
    .returning({ id: captures.id });

  if (!deletedCapture) {
    return jsonError("The capture is unavailable.", 404);
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
