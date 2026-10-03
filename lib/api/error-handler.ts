import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import crypto from 'crypto';
import { AuthorizationError } from '@/lib/auth/context';

export interface SafeApiErrorResponse {
  error: string;
  correlation_id?: string;
  details?: unknown;
}

/**
 * Centralized, secure API error handler.
 * - Maps authorization errors to appropriate 401/403 status codes.
 * - Maps schema validation errors to 400 with field details.
 * - Sanitizes 500 internal errors: emits stable client-safe message and correlation ID,
 *   while logging detailed error internals to server logs for diagnostics.
 */
export class BusinessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessValidationError';
  }
}

export function handleApiError(error: unknown, routeName: string = 'api'): NextResponse<SafeApiErrorResponse> {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    );
  }

  if (error instanceof BusinessValidationError) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: 'Invalid request payload or query parameters', details: error.issues },
      { status: 400 }
    );
  }

  const correlationId = `err-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  console.error(`[${routeName}] Unhandled error (${correlationId}):`, error);

  return NextResponse.json(
    {
      error: 'Internal Server Error',
      correlation_id: correlationId,
    },
    { status: 500 }
  );
}
