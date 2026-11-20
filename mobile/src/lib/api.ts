import { z } from "zod";

const captureSchema = z.object({
  id: z.string().uuid(),
  originalText: z.string(),
  currentText: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const captureListSchema = z.object({
  captures: z.array(captureSchema),
  nextCursor: z.string().uuid().nullable(),
});

const captureResponseSchema = z.object({ capture: captureSchema });
const captureCreateResponseSchema = z.object({
  capture: captureSchema,
  possibleDuplicates: z.array(
    z.object({
      id: z.string().uuid(),
      currentText: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
});
const sessionResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string().nullable(),
  }),
});

const candidateTaskSchema = z.object({
  title: z.string().min(1).max(160),
  due_date: z.string().min(1).max(100).nullable(),
  source_text: z.string().min(1).max(1_000),
  confidence: z.number().min(0).max(1),
});

const itemSchema = z.object({
  id: z.string().uuid(),
  captureId: z.string().uuid(),
  type: z.enum(["task", "idea", "note", "question", "project", "reference"]),
  title: z.string(),
  summary: z.string(),
  labels: z.array(z.string()),
  candidateTasks: z.array(candidateTaskSchema),
  completedTaskIndexes: z.array(z.number().int().nonnegative()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const itemListSchema = z.object({
  items: z.array(itemSchema),
  nextCursor: z.string().uuid().nullable(),
});
const itemDetailSchema = z.object({
  item: itemSchema.extend({
    capture: z.object({ originalText: z.string(), currentText: z.string() }),
  }),
});
const relatedItemsResponseSchema = z.object({
  relatedItems: z.array(itemSchema),
  suggestions: z.array(
    z.object({
      item: itemSchema,
      matchTerms: z.array(z.string()),
      score: z.number().min(0).max(1),
    }),
  ),
});
const relatedItemLinkSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  summary: z.string(),
});

const processingProposalSchema = z.object({
  schema_version: z.literal("1"),
  item_type: z.enum(["task", "idea", "note", "question", "project", "reference"]),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1_000),
  labels: z.array(z.string().min(1).max(40)).max(10),
  candidate_tasks: z.array(candidateTaskSchema).max(10),
  related_item_ids: z.array(z.string().uuid()).max(10),
  clarifying_question: z.string().max(500).nullable(),
  confidence: z.number().min(0).max(1),
  reasoning_summary: z.string().min(1).max(500),
});

const agentSuggestionSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal("1"),
  proposal: processingProposalSchema,
  status: z.enum(["pending", "accepted", "rejected", "stale"]),
  acceptedProposal: processingProposalSchema.nullable(),
  itemId: z.string().uuid().nullable(),
  relatedItems: z.array(relatedItemLinkSchema),
  modelIdentifier: z.string(),
  promptVersion: z.string(),
  createdAt: z.string().datetime(),
});

const agentJobSchema = z.object({
  id: z.string().uuid(),
  captureId: z.string().uuid(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  suggestion: agentSuggestionSchema.nullable(),
});

const agentJobResponseSchema = z.object({ job: agentJobSchema });
const dailyReviewResponseSchema = z.object({
  entries: z.array(
    z.object({
      capture: captureSchema,
      reviewStatus: z.enum([
        "suggestion_ready",
        "processing_failed",
        "processing",
        "needs_processing",
      ]),
      priority: z.enum(["high", "normal", "low"]),
      priorityExplanation: z.string(),
      job: z
        .object({
          id: z.string().uuid(),
          status: z.enum(["queued", "running", "succeeded", "failed"]),
          attemptCount: z.number().int().nonnegative(),
          maxAttempts: z.number().int().positive(),
          errorCode: z.string().nullable(),
        })
        .nullable(),
      suggestion: z
        .object({
          id: z.string().uuid(),
          proposal: processingProposalSchema,
          relatedItems: z.array(relatedItemLinkSchema),
        })
        .nullable(),
    }),
  ),
  nextCursor: z.string().uuid().nullable(),
});
const suggestionDecisionResponseSchema = z.object({
  suggestion: z.object({
    id: z.string().uuid(),
    status: z.enum(["accepted", "rejected", "stale"]),
    acceptedProposal: processingProposalSchema.nullable(),
    itemId: z.string().uuid().nullable(),
    reviewedAt: z.string().datetime().nullable(),
  }),
});

export type Capture = z.infer<typeof captureSchema>;
export type CaptureCreation = z.infer<typeof captureCreateResponseSchema>;
export type BrainDumpItem = z.infer<typeof itemSchema>;
export type BrainDumpItemDetail = z.infer<typeof itemDetailSchema>["item"];
export type RelatedItems = z.infer<typeof relatedItemsResponseSchema>;
export type MobileSession = z.infer<typeof sessionResponseSchema>;
export type ProcessingProposal = z.infer<typeof processingProposalSchema>;
export type AgentSuggestion = z.infer<typeof agentSuggestionSchema>;
export type AgentJob = z.infer<typeof agentJobSchema>;
export type DailyReviewEntry = z.infer<
  typeof dailyReviewResponseSchema
>["entries"][number];
export type SuggestionDecision = z.infer<
  typeof suggestionDecisionResponseSchema
>["suggestion"];

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

function getApiBaseUrl(): string {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!configuredUrl) {
    throw new ApiError("Set EXPO_PUBLIC_API_URL in mobile/.env.local.");
  }

  try {
    return new URL(configuredUrl).toString().replace(/\/$/, "");
  } catch {
    throw new ApiError("EXPO_PUBLIC_API_URL must be a valid URL.");
  }
}

async function request(
  path: string,
  options: {
    token?: string;
    method?: string;
    body?: unknown;
  } = {},
): Promise<unknown> {
  const headers = new Headers();
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError("Could not reach BrainDump. Check your connection.");
  }

  if (response.status === 204) {
    return undefined;
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ApiError("BrainDump returned an invalid response.", response.status);
    }
    throw error;
  }

  if (!response.ok) {
    const message =
      typeof responseBody === "object" &&
      responseBody !== null &&
      "error" in responseBody &&
      typeof responseBody.error === "string"
        ? responseBody.error
        : "The request could not be completed.";
    const code =
      typeof responseBody === "object" &&
      responseBody !== null &&
      "code" in responseBody &&
      typeof responseBody.code === "string"
        ? responseBody.code
        : undefined;
    throw new ApiError(message, response.status, code);
  }

  return responseBody;
}

export async function exchangeGoogleIdToken(
  idToken: string,
): Promise<MobileSession> {
  const response = await request("/api/v1/auth/google", {
    method: "POST",
    body: { idToken },
  });
  return sessionResponseSchema.parse(response);
}

export async function listCaptures(
  token: string,
  search = "",
  before?: string,
): Promise<z.infer<typeof captureListSchema>> {
  const params = new URLSearchParams();
  if (search) {
    params.set("q", search);
  }
  if (before) {
    params.set("before", before);
  }
  const serializedParams = params.toString();
  const query = serializedParams ? `?${serializedParams}` : "";
  const response = await request(`/api/v1/captures${query}`, { token });
  return captureListSchema.parse(response);
}

export async function listItems(
  token: string,
  before?: string,
  search = "",
): Promise<z.infer<typeof itemListSchema>> {
  const params = new URLSearchParams();
  if (before) params.set("before", before);
  if (search) params.set("q", search);
  const serializedParams = params.toString();
  const query = serializedParams ? `?${serializedParams}` : "";
  const response = await request(`/api/v1/items${query}`, { token });
  return itemListSchema.parse(response);
}

export async function getItem(
  token: string,
  itemId: string,
): Promise<BrainDumpItemDetail> {
  const response = await request(`/api/v1/items/${encodeURIComponent(itemId)}`, {
    token,
  });
  return itemDetailSchema.parse(response).item;
}

export async function setTaskCompletion(
  token: string,
  itemId: string,
  taskIndex: number,
  completed: boolean,
): Promise<number[]> {
  const response = await request(
    `/api/v1/items/${encodeURIComponent(itemId)}/tasks/${taskIndex}/completion`,
    { token, method: "PUT", body: { completed } },
  );
  return z.object({ completedTaskIndexes: z.array(z.number().int().nonnegative()) })
    .parse(response).completedTaskIndexes;
}

export async function deleteItem(
  token: string,
  itemId: string,
  options: { deleteCapture: boolean; deleteLinked: boolean },
): Promise<void> {
  const query = new URLSearchParams();
  if (options.deleteCapture) query.set("delete_capture", "true");
  if (options.deleteLinked) query.set("delete_linked", "true");
  const queryString = query.size ? `?${query.toString()}` : "";
  await request(`/api/v1/items/${encodeURIComponent(itemId)}${queryString}`, {
    token,
    method: "DELETE",
  });
}

export async function getRelatedItems(
  token: string,
  itemId: string,
): Promise<RelatedItems> {
  const response = await request(
    `/api/v1/items/${encodeURIComponent(itemId)}/related`,
    { token },
  );
  return relatedItemsResponseSchema.parse(response);
}

export async function addRelatedItem(
  token: string,
  itemId: string,
  relatedItemId: string,
): Promise<void> {
  await request(
    `/api/v1/items/${encodeURIComponent(itemId)}/related/${encodeURIComponent(relatedItemId)}`,
    { token, method: "POST" },
  );
}

export async function removeRelatedItem(
  token: string,
  itemId: string,
  relatedItemId: string,
): Promise<void> {
  await request(
    `/api/v1/items/${encodeURIComponent(itemId)}/related/${encodeURIComponent(relatedItemId)}`,
    { token, method: "DELETE" },
  );
}

export async function createCapture(
  token: string,
  text: string,
): Promise<CaptureCreation> {
  const response = await request("/api/v1/captures", {
    token,
    method: "POST",
    body: { text },
  });
  return captureCreateResponseSchema.parse(response);
}

export async function updateCapture(
  token: string,
  id: string,
  text: string,
): Promise<Capture> {
  const response = await request(`/api/v1/captures/${encodeURIComponent(id)}`, {
    token,
    method: "PATCH",
    body: { text },
  });
  return captureResponseSchema.parse(response).capture;
}

export async function deleteCapture(
  token: string,
  id: string,
): Promise<void> {
  await request(`/api/v1/captures/${encodeURIComponent(id)}`, {
    token,
    method: "DELETE",
  });
}

export async function revokeSession(token: string): Promise<void> {
  await request("/api/v1/auth/session", { token, method: "DELETE" });
}

export async function exportCaptures(token: string): Promise<unknown> {
  return request("/api/v1/export", { token });
}

export async function requestCaptureProcessing(
  token: string,
  captureId: string,
): Promise<AgentJob> {
  const response = await request(
    `/api/v1/captures/${encodeURIComponent(captureId)}/process`,
    { token, method: "POST" },
  );
  return agentJobResponseSchema.parse(response).job;
}

export async function getProcessingJob(
  token: string,
  jobId: string,
): Promise<AgentJob> {
  const response = await request(
    `/api/v1/agent/jobs/${encodeURIComponent(jobId)}`,
    { token },
  );
  return agentJobResponseSchema.parse(response).job;
}

export async function getDailyReviewQueue(
  token: string,
  before?: string,
): Promise<z.infer<typeof dailyReviewResponseSchema>> {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  const response = await request(`/api/v1/review/daily${query}`, { token });
  return dailyReviewResponseSchema.parse(response);
}

export async function deferCaptureReview(
  token: string,
  captureId: string,
): Promise<void> {
  await request(
    `/api/v1/review/captures/${encodeURIComponent(captureId)}/defer`,
    { token, method: "POST" },
  );
}

export async function acceptProcessingSuggestion(
  token: string,
  suggestionId: string,
  proposal: ProcessingProposal,
): Promise<SuggestionDecision> {
  const response = await request(
    `/api/v1/agent/suggestions/${encodeURIComponent(suggestionId)}/accept`,
    { token, method: "POST", body: { proposal } },
  );
  return suggestionDecisionResponseSchema.parse(response).suggestion;
}

export async function rejectProcessingSuggestion(
  token: string,
  suggestionId: string,
): Promise<SuggestionDecision> {
  const response = await request(
    `/api/v1/agent/suggestions/${encodeURIComponent(suggestionId)}/reject`,
    { token, method: "POST" },
  );
  return suggestionDecisionResponseSchema.parse(response).suggestion;
}
