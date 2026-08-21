import process from 'node:process';

export type PlatformId = 'linux' | 'win32' | 'darwin';

export function resolvePlatform(platform: NodeJS.Platform): PlatformId {
  switch (platform) {
    case 'linux':
    case 'win32':
    case 'darwin':
      return platform;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export function currentPlatform(): PlatformId {
  return resolvePlatform(process.platform);
}
