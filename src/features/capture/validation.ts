import { z } from "zod";

export const MAX_CAPTURE_LENGTH = 10_000;

export const captureTextSchema = z
  .string()
  .min(1)
  .max(MAX_CAPTURE_LENGTH)
  .refine((value) => value.trim().length > 0);

export const captureIdSchema = z.string().uuid();

export const MAX_SEARCH_QUERY_LENGTH = 200;

export const captureSearchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SEARCH_QUERY_LENGTH);
