import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

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
  if (!value) throw new Error('Script Path is empty');
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function parseCustomOutput(stdout: string): string {
  const value = stdout.trim();
  if (!value) throw new Error('Script returned empty stdout');
  if (/\r|\n/.test(value)) throw new Error('Script must return exactly one line');
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

export async function runCustomScript(scriptPath: string): Promise<string> {
  const resolvedPath = resolveCustomScriptPath(scriptPath);
  const { stdout } = await execFileAsync(resolvedPath, [], {
    timeout: 20_000,
    maxBuffer: 64 * 1024,
  });
  return parseCustomOutput(stdout);
}
