import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { ProviderError } from './provider-error.ts';

const execFileAsync = promisify(execFile);

export const CUSTOM_STATUS_MAX_LENGTH = 10;

export interface CustomProviderConfig {
  label: string;
  script: string;
  visible: boolean;
}

export type CustomProviderMap = Record<string, CustomProviderConfig>;

export function normalizeCustomProviders(configured: Record<string, unknown>): CustomProviderMap {
  const result: CustomProviderMap = {};
  for (const [rawName, rawConfig] of Object.entries(configured)) {
    const name = rawName.trim();
    if (!name) continue;

    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue;
    const candidate = rawConfig as Record<string, unknown>;
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const script = typeof candidate.script === 'string' ? candidate.script.trim() : '';
    if (!label || !script) continue;
    result[name] = {
      label,
      script,
      visible: typeof candidate.visible === 'boolean' ? candidate.visible : true,
    };
  }
  return result;
}

export function resolveCustomScriptPath(scriptPath: string): string {
  const value = scriptPath.trim();
  if (!value) throw new ProviderError('SCRIPT_NOT_FOUND', 'Script Path is empty');
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function parseCustomOutput(stdout: string): string {
  const value = stdout.trim();
  if (!value) throw new ProviderError('SCRIPT_BAD_OUTPUT', 'Script returned empty stdout');
  if (/\r|\n/.test(value)) {
    throw new ProviderError('SCRIPT_BAD_OUTPUT', 'Script must return exactly one line');
  }
  return value;
}

export function truncateCustomStatus(value: string): string {
  const chars = [...value];
  if (chars.length <= CUSTOM_STATUS_MAX_LENGTH) return value;
  return `${chars.slice(0, CUSTOM_STATUS_MAX_LENGTH - 1).join('')}…`;
}

export function formatCustomStatus(label: string, output: string): string {
  const prefix = label.trim();
  return truncateCustomStatus(prefix ? `${prefix} ${output}` : output);
}

function classifyScriptFailure(error: unknown, resolvedPath: string): ProviderError {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENOENT') {
    return new ProviderError('SCRIPT_NOT_FOUND', 'Not Found', resolvedPath);
  }
  if (typeof code === 'number') {
    return new ProviderError('SCRIPT_FAILED', `Script failed with exit code ${code}`);
  }
  const signal = (error as { signal?: unknown } | null)?.signal;
  if (typeof signal === 'string') {
    return new ProviderError('SCRIPT_FAILED', `Script failed with signal ${signal}`);
  }
  return new ProviderError('SCRIPT_FAILED', 'Script failed before producing output');
}

export async function runCustomScript(scriptPath: string): Promise<string> {
  const resolvedPath = resolveCustomScriptPath(scriptPath);
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(resolvedPath, [], {
      timeout: 20_000,
      maxBuffer: 64 * 1024,
    }));
  } catch (error) {
    throw classifyScriptFailure(error, resolvedPath);
  }
  return parseCustomOutput(stdout);
}
