export const mobileApiHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export class InvalidJsonBodyError extends Error {
  constructor() {
    super("The request body must be valid JSON.");
  }
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("The request body is too large.");
  }
}

export async function readJsonBody(
  request: Request,
  maxBytes = 50_000,
): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new RequestBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new InvalidJsonBodyError();
  }

  const decoder = new TextDecoder();
  let body = "";
  let bytesRead = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }

    body += decoder.decode(value, { stream: true });
  }

  body += decoder.decode();
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InvalidJsonBodyError();
    }
    throw error;
  }
}

export function jsonError(message: string, status: number): Response {
  return Response.json(
    { error: message },
    { status, headers: mobileApiHeaders },
  );
}

export function bodyErrorResponse(error: unknown): Response | undefined {
  if (error instanceof RequestBodyTooLargeError) {
    return jsonError(error.message, 413);
  }
  if (error instanceof InvalidJsonBodyError) {
    return jsonError(error.message, 400);
  }
  return undefined;
}
