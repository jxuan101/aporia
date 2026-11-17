import { and, desc, eq, ilike, lt, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { captures } from "@/db/schema";
import {
  createCaptureSearchPattern,
} from "@/features/capture/search";
import {
  captureIdSchema,
  captureSearchQuerySchema,
  captureTextSchema,
} from "@/features/capture/validation";
import {
  bodyErrorResponse,
  jsonError,
  mobileApiHeaders,
  readJsonBody,
} from "@/features/mobile-api/http";
import { serializeCapture } from "@/features/mobile-api/captures";
import { getMobileUserId } from "@/features/mobile-api/session";

const PAGE_SIZE = 30;
const captureBodySchema = z.object({ text: captureTextSchema }).strict();

export async function GET(request: Request): Promise<Response> {
  const userId = await getMobileUserId(request);
  if (!userId) {
    return jsonError("Authentication required.", 401);
  }

  const params = new URL(request.url).searchParams;
  const rawSearch = params.get("q");
  const rawCursor = params.get("before");
  const searchResult =
    rawSearch === null || rawSearch === ""
      ? undefined
      : captureSearchQuerySchema.safeParse(rawSearch);
  const cursorResult =
    rawCursor === null ? undefined : captureIdSchema.safeParse(rawCursor);

  if (searchResult && !searchResult.success) {
    return jsonError("Search must be between 1 and 200 characters.", 400);
  }
  if (cursorResult && !cursorResult.success) {
    return jsonError("The page cursor is invalid.", 400);
  }

  const searchQuery = searchResult?.success ? searchResult.data : undefined;
  const cursorId = cursorResult?.success ? cursorResult.data : undefined;
  const [cursor] = cursorId
    ? await db
        .select({ id: captures.id, createdAt: captures.createdAt })
        .from(captures)
        .where(and(eq(captures.id, cursorId), eq(captures.userId, userId)))
        .limit(1)
    : [];

  if (cursorId && !cursor) {
    return jsonError("The page cursor is invalid.", 400);
  }

  const userFilter = cursor
    ? and(
        eq(captures.userId, userId),
        or(
          lt(captures.createdAt, cursor.createdAt),
          and(
            eq(captures.createdAt, cursor.createdAt),
            lt(captures.id, cursor.id),
          ),
        ),
      )
    : eq(captures.userId, userId);
  const searchFilter = searchQuery
    ? or(
        ilike(captures.rawText, createCaptureSearchPattern(searchQuery)),
        ilike(
          captures.currentText,
          createCaptureSearchPattern(searchQuery),
        ),
      )
    : undefined;
  const rows = await db
    .select()
    .from(captures)
    .where(searchFilter ? and(userFilter, searchFilter) : userFilter)
    .orderBy(desc(captures.createdAt), desc(captures.id))
    .limit(PAGE_SIZE + 1);
  const hasMore = rows.length > PAGE_SIZE;
  const visibleCaptures = rows.slice(0, PAGE_SIZE);

  return Response.json(
    {
      captures: visibleCaptures.map(serializeCapture),
      nextCursor: hasMore ? visibleCaptures.at(-1)?.id ?? null : null,
    },
    { headers: mobileApiHeaders },
  );
}

export async function POST(request: Request): Promise<Response> {
  const userId = await getMobileUserId(request);
  if (!userId) {
    return jsonError("Authentication required.", 401);
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

  const result = captureBodySchema.safeParse(body);
  if (!result.success) {
    return jsonError("Enter a thought of up to 10,000 characters.", 400);
  }

  const [capture] = await db
    .insert(captures)
    .values({
      userId,
      rawText: result.data.text,
      currentText: result.data.text,
    })
    .returning();

  return Response.json(
    { capture: serializeCapture(capture) },
    { status: 201, headers: mobileApiHeaders },
  );
}
