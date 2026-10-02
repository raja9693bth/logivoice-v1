/**
 * LOGIVOICE V1 — AUTHENTICATION, AUTHORIZATION & TENANT CONTEXT
 * Enforces server-side tenant isolation, role-based access control (RBAC),
 * session validation, and cryptographic webhook signature verification.
 *
 * Security Architecture:
 * - USER AUTH: Supabase Auth session via Bearer JWT or SSR Cookies.
 * - RETELL AUTH: Dedicated server-to-server API key granting strictly VOICE_GATEWAY role.
 * - INTERNAL SERVICE AUTH: System role for internal background processing.
 * - ZERO CLIENT SPOOFING: x-user-role and x-tenant-id headers are never trusted for elevation.
 * - PRODUCTION HARDENED: Dev/test tokens are strictly forbidden in production.
 */

import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { Retell } from 'retell-sdk';
import { createAdminClient } from '@/lib/supabase/server';
import { DEFAULT_TENANT_ID } from '@/lib/db';

export type UserRole = 'DISPATCHER' | 'OPS_MANAGER' | 'ADMIN' | 'VOICE_GATEWAY' | 'SYSTEM';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  isAuthenticated: boolean;
  source: 'SUPABASE_SESSION' | 'API_TOKEN' | 'WEBHOOK_SIGNATURE' | 'DEV_SESSION' | 'INTERNAL_CALL' | 'UNAUTHENTICATED';
}

export class AuthorizationError extends Error {
  constructor(message: string, public statusCode: number = 403) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Verifies a Retell webhook or tool signature using raw HTTP body bytes.
 * Validates against the official Retell SDK contract (v=<timestamp>,d=<digest> with replay protection)
 * and falls back to constant-time direct HMAC-SHA256 hex comparison for legacy/custom calls.
 */
export async function verifyRetellWebhookSignature(rawBody: string, signature: string | null): Promise<boolean> {
  const apiKey = process.env.RETELL_API_KEY;
  if (!signature || !apiKey) return false;

  try {
    // 1. Official Retell SDK verification (handles timestamped v=<timestamp>,d=<digest> with replay protection)
    if (signature.startsWith('v=') || signature.includes(',d=')) {
      return await Retell.verify(rawBody, apiKey, signature);
    }

    // 2. Direct HMAC-SHA256 hex verification (legacy & custom signature format)
    // Strictly gated behind RETELL_ALLOW_LEGACY_SIGNATURE=true (prohibited by default in production)
    const allowLegacy = process.env.RETELL_ALLOW_LEGACY_SIGNATURE === 'true';
    if (!allowLegacy) {
      return false;
    }

    const expected = crypto.createHmac('sha256', apiKey).update(rawBody).digest('hex');
    const sigBuffer = Buffer.from(signature);
    const expBuffer = Buffer.from(expected);

    if (sigBuffer.length !== expBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuffer, expBuffer);
  } catch {
    return false;
  }
}

// Role and Tenant UUID Validators (Section 3)
export const ALLOWED_USER_ROLES: UserRole[] = ['DISPATCHER', 'OPS_MANAGER', 'ADMIN'];
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUserRole(role: unknown): role is 'DISPATCHER' | 'OPS_MANAGER' | 'ADMIN' {
  return typeof role === 'string' && ALLOWED_USER_ROLES.includes(role as UserRole);
}

export function isValidTenantId(tenantId: unknown): boolean {
  return typeof tenantId === 'string' && UUID_REGEX.test(tenantId);
}

/**
 * Explicit internal-only system invocation boundary.
 * Never reachable from a public HTTP request. Must be called explicitly by background scripts or workers.
 */
export function getInternalSystemContext(tenantId: string = DEFAULT_TENANT_ID): AuthContext {
  return {
    userId: 'system',
    tenantId,
    role: 'SYSTEM',
    isAuthenticated: true,
    source: 'INTERNAL_CALL',
  };
}

/**
 * Resolves the authenticated user, role, and tenant context from a Next.js request.
 * Strictly enforces that client-controlled headers cannot escalate privileges or override tenant boundaries.
 */
export async function getAuthContext(
  req?: NextRequest | Request | Headers | { headers: Headers; cookies?: { get?: (name: string) => { value: string } | undefined; getAll?: () => Array<{ name: string; value: string }> } }
): Promise<AuthContext> {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!req) {
    // Calling getAuthContext without an explicit Request NEVER yields SYSTEM privileges.
    // Any public or uncontrolled route invocation omitting req fails closed as unauthenticated.
    return {
      userId: 'anonymous',
      tenantId: '',
      role: 'DISPATCHER',
      isAuthenticated: false,
      source: 'UNAUTHENTICATED',
    };
  }

  const headers: Headers =
    req instanceof Headers
      ? req
      : req && typeof req === 'object' && 'headers' in req && req.headers
      ? (req.headers as Headers)
      : new Headers();

  // Explicit test header to simulate unauthenticated requests in test suites
  if (headers.get('x-test-unauthenticated') === 'true') {
    return {
      userId: 'anonymous',
      tenantId: '',
      role: 'DISPATCHER',
      isAuthenticated: false,
      source: 'UNAUTHENTICATED',
    };
  }

  const authHeader = headers.get('authorization');
  const apiKey = headers.get('x-api-key');

  // 1. Server-to-Server Retell API Key Verification
  // Strictly bound to VOICE_GATEWAY role and DEFAULT_TENANT_ID; ignores any header override attempts.
  const serverKey = process.env.RETELL_API_KEY;
  if (apiKey && serverKey && apiKey === serverKey) {
    return {
      userId: 'voice-api-caller',
      tenantId: DEFAULT_TENANT_ID,
      role: 'VOICE_GATEWAY',
      isAuthenticated: true,
      source: 'API_TOKEN',
    };
  }

  // 2. Authorization Bearer Token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();

    // Dev/Test tokens ONLY permitted in non-production environments
    if (!isProduction) {
      if (token === 'dev-dispatcher-token' || token === 'test-token') {
        const testTenant = headers.get('x-test-tenant-override') || DEFAULT_TENANT_ID;
        return {
          userId: 'dispatcher-local-01',
          tenantId: testTenant,
          role: 'DISPATCHER',
          isAuthenticated: true,
          source: 'DEV_SESSION',
        };
      }

      if (token === 'admin-test-token') {
        return {
          userId: 'admin-local-01',
          tenantId: DEFAULT_TENANT_ID,
          role: 'ADMIN',
          isAuthenticated: true,
          source: 'API_TOKEN',
        };
      }
    }

    // Authoritative Supabase JWT validation
    try {
      const client = createAdminClient();
      const { data: { user }, error } = await client.auth.getUser(token);
      if (!error && user) {
        const metadataTenant = user.app_metadata?.tenant_id as string | undefined;
        const metadataRole = user.app_metadata?.role as unknown;

        // Strict runtime validation: Role MUST be in ALLOWED_USER_ROLES
        // SYSTEM and VOICE_GATEWAY can NEVER be granted via user metadata
        if (!isValidUserRole(metadataRole)) {
          console.warn('[AuthContext] Rejected user with invalid or forbidden role metadata:', metadataRole);
          return {
            userId: user.id,
            tenantId: '',
            role: 'DISPATCHER',
            isAuthenticated: false,
            source: 'UNAUTHENTICATED',
          };
        }

        // In production, tenant_id is strictly required and must be a valid UUID
        // NEVER silently fall back to DEFAULT_TENANT_ID for a production user
        if (isProduction || metadataTenant) {
          if (!isValidTenantId(metadataTenant)) {
            console.warn('[AuthContext] Rejected user with invalid or missing tenant UUID in metadata:', metadataTenant);
            return {
              userId: user.id,
              tenantId: '',
              role: 'DISPATCHER',
              isAuthenticated: false,
              source: 'UNAUTHENTICATED',
            };
          }
        }

        const tenantId = metadataTenant || DEFAULT_TENANT_ID;
        const role = metadataRole;
        return {
          userId: user.id,
          tenantId,
          role,
          isAuthenticated: true,
          source: 'SUPABASE_SESSION',
        };
      }
    } catch (err) {
      console.warn('[AuthContext] JWT token validation failed:', err instanceof Error ? err.message : err);
    }
  }

  // 3. Supabase SSR Session via Cookies (for browser-initiated API calls)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (supabaseUrl && supabaseKey && 'cookies' in req && req.cookies && typeof req.cookies.getAll === 'function') {
    try {
      const cookiesObj = req.cookies;
      const supabase = createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
          getAll() {
            return cookiesObj.getAll ? cookiesObj.getAll() : [];
          },
          setAll() {},
        },
      });

      const { data: { user }, error } = await supabase.auth.getUser();
      if (!error && user) {
        const metadataTenant = user.app_metadata?.tenant_id as string | undefined;
        const metadataRole = user.app_metadata?.role as unknown;

        if (!isValidUserRole(metadataRole)) {
          console.warn('[AuthContext] Rejected cookie session with invalid role metadata:', metadataRole);
          return {
            userId: user.id,
            tenantId: '',
            role: 'DISPATCHER',
            isAuthenticated: false,
            source: 'UNAUTHENTICATED',
          };
        }

        if (isProduction || metadataTenant) {
          if (!isValidTenantId(metadataTenant)) {
            console.warn('[AuthContext] Rejected cookie session with invalid tenant UUID in metadata:', metadataTenant);
            return {
              userId: user.id,
              tenantId: '',
              role: 'DISPATCHER',
              isAuthenticated: false,
              source: 'UNAUTHENTICATED',
            };
          }
        }

        const tenantId = metadataTenant || DEFAULT_TENANT_ID;
        const role = metadataRole;
        return {
          userId: user.id,
          tenantId,
          role,
          isAuthenticated: true,
          source: 'SUPABASE_SESSION',
        };
      }
    } catch {
      // Cookie session verification failed or unavailable
    }
  }

  // 4. Non-Production Dev Session Cookie (allows local UI exploration when configured)
  if (!isProduction && 'cookies' in req && req.cookies && typeof req.cookies.get === 'function') {
    const devCookie = req.cookies.get('logivoice_dev_session')?.value;
    if (devCookie === 'true') {
      return {
        userId: 'dispatcher-local-01',
        tenantId: DEFAULT_TENANT_ID,
        role: 'DISPATCHER',
        isAuthenticated: true,
        source: 'DEV_SESSION',
      };
    }
  }

  // 5. Default Unauthenticated Fallback
  return {
    userId: 'anonymous',
    tenantId: '',
    role: 'DISPATCHER',
    isAuthenticated: false,
    source: 'UNAUTHENTICATED',
  };
}

export const resolveAuthContext = getAuthContext;

/**
 * Enforces that the request has an authenticated identity.
 */
export function requireAuth(context: AuthContext | null | undefined) {
  if (!context || !context.isAuthenticated) {
    throw new AuthorizationError('Authentication required', 401);
  }
}

/**
 * Enforces that the user has at least one of the required roles.
 */
export function requireRole(context: AuthContext, allowedRoles: UserRole[]) {
  requireAuth(context);
  if (!allowedRoles.includes(context.role)) {
    throw new AuthorizationError(`Insufficient permissions. Required role: ${allowedRoles.join(', ')}`, 403);
  }
}

/**
 * Validates that an operation on a resource does not cross tenant boundaries.
 */
export function assertTenantAccess(context: AuthContext, targetTenantId: string) {
  requireAuth(context);
  if (context.tenantId !== targetTenantId) {
    throw new AuthorizationError('Cross-tenant access forbidden: resource belongs to another tenant', 403);
  }
}
