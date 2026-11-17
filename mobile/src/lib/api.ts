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
  modelIdentifier: z.string(),
  promptVersion: z.string(),
  createdAt: z.string().datetime(),
});

const agentJobSchema = z.object({
  id: z.string().uuid(),
  captureId: z.string().uuid(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  attemptCount: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  suggestion: agentSuggestionSchema.nullable(),
});

const agentJobResponseSchema = z.object({ job: agentJobSchema });
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
export type BrainDumpItem = z.infer<typeof itemSchema>;
export type BrainDumpItemDetail = z.infer<typeof itemDetailSchema>["item"];
export type MobileSession = z.infer<typeof sessionResponseSchema>;
export type ProcessingProposal = z.infer<typeof processingProposalSchema>;
export type AgentSuggestion = z.infer<typeof agentSuggestionSchema>;
export type AgentJob = z.infer<typeof agentJobSchema>;
export type SuggestionDecision = z.infer<
  typeof suggestionDecisionResponseSchema
>["suggestion"];

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
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
    throw new ApiError(message, response.status);
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

export async function createCapture(
  token: string,
  text: string,
): Promise<Capture> {
  const response = await request("/api/v1/captures", {
    token,
    method: "POST",
    body: { text },
  });
  return captureResponseSchema.parse(response).capture;
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
