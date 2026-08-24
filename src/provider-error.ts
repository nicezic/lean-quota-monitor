export type ProviderErrorCode =
  | 'CLI_NOT_FOUND'
  | 'AUTH_REQUIRED'
  | 'KEY_MISSING'
  | 'KEY_INVALID'
  | 'PLAN_REQUIRED'
  | 'QUOTA_EXHAUSTED'
  | 'SCHEMA_CHANGED'
  | 'SCRIPT_NOT_FOUND'
  | 'SCRIPT_FAILED'
  | 'SCRIPT_BAD_OUTPUT';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly detail?: string;

  constructor(code: ProviderErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.detail = detail;
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
