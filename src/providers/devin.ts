import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import process from 'node:process';
import type { BuiltInProviderDefinition } from '../provider-definition.ts';
import { hasErrorCode, ProviderError } from '../provider-error.ts';
import { pickPresentedWindow, type QuotaSnapshot, type QuotaWindow } from '../types.ts';

export function readVarint(buf: Uint8Array, offset: number): [number, number] {
  let res = 0;
  let multiplier = 1;
  let pos = offset;
  while (pos < buf.length) {
    const b = buf[pos++];
    res += (b % 128) * multiplier;
    multiplier *= 128;
    if (b < 128) break;
  }
  return [res, pos];
}

export function encodeVarint(v: number): number[] {
  const res: number[] = [];
  let current = v;
  while (current >= 128) {
    res.push((current % 128) + 128);
    current = Math.floor(current / 128);
  }
  res.push(current);
  return res;
}

export function encodeLengthDelimited(fieldNum: number, data: Uint8Array): Uint8Array {
  const tag = fieldNum * 8 + 2;
  const tagBytes = encodeVarint(tag);
  const lenBytes = encodeVarint(data.length);
  const result = new Uint8Array(tagBytes.length + lenBytes.length + data.length);
  result.set(tagBytes, 0);
  result.set(lenBytes, tagBytes.length);
  result.set(data, tagBytes.length + lenBytes.length);
  return result;
}

export interface DevinPlanRaw {
  dailyPercent?: number;
  weeklyPercent?: number;
  dailyResetAt?: Date;
  weeklyResetAt?: Date;
}

function parsePlanStatus(buf: Uint8Array): DevinPlanRaw {
  let sp = 0;
  let dailyPercent: number | undefined;
  let weeklyPercent: number | undefined;
  let dailyResetAt: Date | undefined;
  let weeklyResetAt: Date | undefined;

  while (sp < buf.length) {
    const [sTagWire, sNextPos] = readVarint(buf, sp);
    sp = sNextPos;
    const sFieldNum = Math.floor(sTagWire / 8);
    const sWireType = sTagWire % 8;

    if (sWireType === 0) {
      const [val, np] = readVarint(buf, sp);
      sp = np;
      if (sFieldNum === 14) dailyPercent = val;
      if (sFieldNum === 15) weeklyPercent = val;
      if (sFieldNum === 17 && val > 0) dailyResetAt = new Date(val * 1000);
      if (sFieldNum === 18 && val > 0) weeklyResetAt = new Date(val * 1000);
    } else if (sWireType === 2) {
      const [slen, np] = readVarint(buf, sp);
      sp = np + slen;
    } else if (sWireType === 1) {
      sp += 8;
    } else if (sWireType === 5) {
      sp += 4;
    } else {
      break;
    }
  }
  return { dailyPercent, weeklyPercent, dailyResetAt, weeklyResetAt };
}

export function parseDevinUserStatus(buf: Uint8Array): DevinPlanRaw {
  let pos = 0;
  while (pos < buf.length) {
    const [tagWire, nextPos] = readVarint(buf, pos);
    pos = nextPos;
    const fieldNum = Math.floor(tagWire / 8);
    const wireType = tagWire % 8;

    if (wireType === 0) {
      const [_, p] = readVarint(buf, pos);
      pos = p;
    } else if (wireType === 2) {
      const [len, p] = readVarint(buf, pos);
      pos = p;
      const sub = buf.subarray(pos, pos + len);
      pos += len;
      if (fieldNum === 1) {
        const inner = parseDevinUserStatus(sub);
        if (inner.dailyPercent !== undefined || inner.weeklyPercent !== undefined) return inner;
      }
      if (fieldNum === 13) {
        return parsePlanStatus(sub);
      }
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      break;
    }
  }
  return {};
}

export function parseDevinQuota(raw: DevinPlanRaw): QuotaSnapshot {
  const windows: QuotaWindow[] = [];
  if (typeof raw.weeklyPercent === 'number' && Number.isFinite(raw.weeklyPercent)) {
    const remainingPercent = Math.max(0, Math.min(100, raw.weeklyPercent));
    windows.push({
      type: '1week',
      usedPercent: 100 - remainingPercent,
      remainingPercent,
      resetAt: raw.weeklyResetAt,
    });
  }
  if (typeof raw.dailyPercent === 'number' && Number.isFinite(raw.dailyPercent)) {
    const remainingPercent = Math.max(0, Math.min(100, raw.dailyPercent));
    windows.push({
      type: '1day',
      usedPercent: 100 - remainingPercent,
      remainingPercent,
      resetAt: raw.dailyResetAt,
    });
  }

  if (windows.length === 0) {
    throw new ProviderError('SCHEMA_CHANGED', 'No supported Devin quota windows');
  }

  const presentedWindow = pickPresentedWindow(windows, '1week');
  return {
    kind: 'quota',
    providerId: 'devin',
    presentedWindow,
    windows,
  };
}

export function extractDevinApiKey(content: string): string | undefined {
  const match = content.match(/windsurf_api_key\s*=\s*"([^"]+)"/);
  return match?.[1]?.trim();
}

export function getDevinDataDir(): string {
  if (process.env.DEVIN_DATA_DIR) return process.env.DEVIN_DATA_DIR;
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'devin');
  }
  return path.join(os.homedir(), '.local', 'share', 'devin');
}

export function getDevinCacheDir(): string {
  if (process.env.DEVIN_CACHE_DIR) return process.env.DEVIN_CACHE_DIR;
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'devin');
  }
  return path.join(os.homedir(), '.cache', 'devin', 'cli');
}

export async function readDevinCredentialsKey(): Promise<string> {
  const credsPath = path.join(getDevinDataDir(), 'credentials.toml');
  try {
    const content = await fs.readFile(credsPath, 'utf8');
    const key = extractDevinApiKey(content);
    if (key) return key;
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
  const envKey = process.env.WINDSURF_API_KEY?.trim() || process.env.DEVIN_API_KEY?.trim();
  if (envKey) return envKey;
  throw new ProviderError('AUTH_REQUIRED', 'Devin login required');
}

export function buildDevinStatusRequestBody(key: string): Uint8Array {
  const encoder = new TextEncoder();
  const metaParts = [
    encodeLengthDelimited(1, encoder.encode('chisel')),
    encodeLengthDelimited(2, encoder.encode('0.0.0-dev')),
    encodeLengthDelimited(3, encoder.encode(key)),
    encodeLengthDelimited(4, encoder.encode('en')),
    encodeLengthDelimited(5, encoder.encode(process.platform === 'win32' ? 'windows' : 'linux')),
    encodeLengthDelimited(7, encoder.encode('0.0.0-dev')),
    encodeLengthDelimited(12, encoder.encode('chisel')),
    encodeLengthDelimited(31, encoder.encode('0'.repeat(64))),
  ];
  const metaLen = metaParts.reduce((acc, p) => acc + p.length, 0);
  const meta = new Uint8Array(metaLen);
  let off = 0;
  for (const p of metaParts) {
    meta.set(p, off);
    off += p.length;
  }
  return encodeLengthDelimited(1, meta);
}

export async function fetchDevinQuotaLive(): Promise<QuotaSnapshot> {
  const key = await readDevinCredentialsKey();
  const body = buildDevinStatusRequestBody(key);

  const response = await fetch(
    'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus',
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${key}`,
        'content-type': 'application/proto',
        'connect-protocol-version': '1',
        'User-Agent': 'lean-quota-monitor',
      },
      body: Buffer.from(body),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (response.status === 401 || response.status === 403) {
    throw new ProviderError('KEY_INVALID', 'Devin authentication failed');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const rawBytes = new Uint8Array(await response.arrayBuffer());
  const parsed = parseDevinUserStatus(rawBytes);
  return parseDevinQuota(parsed);
}

export async function fetchDevinQuotaFromCache(): Promise<QuotaSnapshot> {
  const cacheDir = getDevinCacheDir();
  let files: string[];
  try {
    files = (await fs.readdir(cacheDir)).filter(
      (f) => f.startsWith('user_status.') && f.endsWith('.bin'),
    );
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new ProviderError('AUTH_REQUIRED', 'Devin cache not found');
    }
    throw error;
  }

  if (files.length === 0) {
    throw new ProviderError('AUTH_REQUIRED', 'Devin cache empty');
  }

  let newestFile = files[0];
  let newestMtime = 0;
  for (const f of files) {
    try {
      const st = await fs.stat(path.join(cacheDir, f));
      if (st.mtimeMs > newestMtime) {
        newestMtime = st.mtimeMs;
        newestFile = f;
      }
    } catch {
      // ignore stat errors
    }
  }

  const rawText = await fs.readFile(path.join(cacheDir, newestFile), 'utf8');
  let payloadBase64: string | undefined;
  try {
    const json = JSON.parse(rawText) as { payload?: string };
    payloadBase64 = json.payload;
  } catch {
    throw new ProviderError('SCHEMA_CHANGED', 'Invalid Devin cache format');
  }

  if (!payloadBase64 || typeof payloadBase64 !== 'string') {
    throw new ProviderError('SCHEMA_CHANGED', 'Missing payload in Devin cache');
  }

  const buf = Buffer.from(payloadBase64, 'base64');
  const parsed = parseDevinUserStatus(new Uint8Array(buf));
  return parseDevinQuota(parsed);
}

export const devinProvider: BuiltInProviderDefinition = {
  id: 'devin',
  statusBarName: 'DEV',
  providerName: 'Devin',
  snapshotPlan() {
    const credsPath = path.join(getDevinDataDir(), 'credentials.toml');
    return {
      kind: 'available',
      paths: [
        {
          id: 'devin-live-rpc',
          acquire: fetchDevinQuotaLive,
          troubleshoot: {
            title: 'Devin login',
            setup: 'Install Devin CLI → devin auth login',
            lookup: { kind: 'file', path: credsPath },
          },
        },
        {
          id: 'devin-local-cache',
          acquire: fetchDevinQuotaFromCache,
          troubleshoot: {
            title: 'Devin local cache',
            setup: 'Install Devin CLI → run session to warm cache',
            lookup: { kind: 'file', path: getDevinCacheDir() },
          },
        },
      ],
    };
  },
};
