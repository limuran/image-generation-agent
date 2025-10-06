const DEFAULT_TTL_MS = 30 * 60 * 1000;

type CacheKey = `${string}#${number}`;

interface CachedImage {
  buffer: Uint8Array;
  mimeType: string;
  expiresAt: number;
}

const imageCache = new Map<CacheKey, CachedImage>();

function buildKey(taskId: string, imageIndex: number): CacheKey {
  return `${taskId}#${imageIndex}`;
}

function cleanupExpired(now = Date.now()): void {
  for (const [key, value] of imageCache.entries()) {
    if (value.expiresAt <= now) {
      imageCache.delete(key);
    }
  }
}

function stripDataUrlPrefix(base64: string): string {
  return base64.replace(/^data:[^;]+;base64,/, '');
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function saveImageToCache(
  taskId: string,
  imageIndex: number,
  base64Data: string,
  mimeType: string,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  cleanupExpired();

  const pureBase64 = stripDataUrlPrefix(base64Data);
  const buffer = decodeBase64(pureBase64);

  imageCache.set(buildKey(taskId, imageIndex), {
    buffer,
    mimeType,
    expiresAt: Date.now() + ttlMs,
  });
}

export function getImageFromCache(
  taskId: string,
  imageIndex: number
): { buffer: Uint8Array; mimeType: string } | undefined {
  cleanupExpired();

  const cached = imageCache.get(buildKey(taskId, imageIndex));
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    imageCache.delete(buildKey(taskId, imageIndex));
    return undefined;
  }

  return { buffer: cached.buffer, mimeType: cached.mimeType };
}

export function removeImageFromCache(taskId: string, imageIndex: number): void {
  imageCache.delete(buildKey(taskId, imageIndex));
}

export function getCachedImageCount(): number {
  cleanupExpired();
  return imageCache.size;
}
