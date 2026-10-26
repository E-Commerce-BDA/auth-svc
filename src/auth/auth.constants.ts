/**
 * Cross-service access-token protocol values.
 *
 * These are protocol constants, not secrets: auth-svc signs with them and
 * every service that verifies an admin token (starting with cart-svc) must
 * use the same values. Keep them duplicated until `@ecom/contracts` exists.
 */
export const JWT_ISSUER = 'ecom-auth';
export const JWT_AUDIENCE = 'ecom-api';
export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_CLOCK_TOLERANCE_SECONDS = 30;
