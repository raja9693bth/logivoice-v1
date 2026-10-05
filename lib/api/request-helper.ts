import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Safely parses JSON body from NextRequest, returning a standardized 400 error response if invalid.
 */
export async function parseJsonBody<T = unknown>(
  req: NextRequest
): Promise<{ data: T; errorResponse: null } | { data: null; errorResponse: NextResponse }> {
  try {
    const data = (await req.json()) as T;
    return { data, errorResponse: null };
  } catch {
    return {
      data: null,
      errorResponse: NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 }),
    };
  }
}

/**
 * Safely parses and validates JSON body using a Zod schema.
 */
export async function parseAndValidateJson<T>(
  req: NextRequest,
  schema: z.ZodSchema<T>
): Promise<{ data: T; errorResponse: null } | { data: null; errorResponse: NextResponse }> {
  const jsonResult = await parseJsonBody(req);
  if (jsonResult.errorResponse) {
    return jsonResult;
  }
  const result = schema.safeParse(jsonResult.data);
  if (!result.success) {
    return {
      data: null,
      errorResponse: NextResponse.json(
        { error: 'Validation failed', details: result.error.flatten() },
        { status: 400 }
      ),
    };
  }
  return { data: result.data, errorResponse: null };
}
