import { randomBytes } from "node:crypto";

export function getBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  return match?.[1];
}

export function createMobileSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
