export type ErrorCode =
  | 'ERR_INVALID_SCHEMA'
  | 'ERR_UNSUPPORTED_VERSION'
  | 'ERR_CYCLE_DETECTED'
  | 'ERR_MISSING_ASSET'
  | 'ERR_ASSET_IN_USE'
  | 'ERR_MISSING_PARENT'
  | 'ERR_NODE_HAS_CHILDREN'
  | 'ERR_SINGULAR_TRANSFORM'
  | 'ERR_SHEAR_NOT_REPRESENTABLE'
  | 'ERR_ANIMATED_TRANSFORM_LOCKED'
  | 'ERR_INVALID_RANGE'
  | 'ERR_INVALID_FPS'
  | 'ERR_DUPLICATE_KEY'
  | 'ERR_PENDING_DRAFT'
  | 'ERR_CODEC_UNSUPPORTED'
  | 'ERR_RENDER_NOT_READY'
  | 'ERR_EXPORT_CANCELLED'
  | 'ERR_EXPORT_FAILED'
  | 'ERR_ARCHIVE_INVALID'
  | 'ERR_ARCHIVE_LIMIT_EXCEEDED'
  | 'ERR_PATH_TRAVERSAL'
  | 'ERR_INVALID_IMAGE'
  | 'ERR_RECOVERY_FAILED'
  | 'ERR_UNKNOWN_FIXTURE'
  | 'ERR_INVALID_COMMAND';

export type ErrorDetails = Record<string, string | number | boolean | null>;

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: ErrorDetails;

  constructor(code: ErrorCode, message: string, details?: ErrorDetails) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
