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

export type Capture = z.infer<typeof captureSchema>;
export type MobileSession = z.infer<typeof sessionResponseSchema>;

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
