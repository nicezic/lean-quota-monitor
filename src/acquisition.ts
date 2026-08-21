export interface AcquisitionPath<T> {
  id: string;
  acquire: () => Promise<T>;
}

export interface AcquisitionResult<T> {
  value: T;
  acquiredVia: string;
}

export interface AcquisitionPathFailure {
  pathId: string;
  error: unknown;
}

export class AcquisitionPathsError extends Error {
  readonly failures: readonly AcquisitionPathFailure[];

  constructor(failures: readonly AcquisitionPathFailure[]) {
    super(`All acquisition paths failed: ${failures.map(({ pathId }) => pathId).join(', ')}`);
    this.name = 'AcquisitionPathsError';
    this.failures = failures;
  }
}

export async function acquireFromPaths<T>(
  paths: readonly AcquisitionPath<T>[],
): Promise<AcquisitionResult<T>> {
  if (paths.length === 0) throw new Error('No acquisition paths configured');

  const failures: AcquisitionPathFailure[] = [];
  for (const path of paths) {
    try {
      return { value: await path.acquire(), acquiredVia: path.id };
    } catch (error) {
      failures.push({ pathId: path.id, error });
    }
  }

  throw new AcquisitionPathsError(failures);
}
