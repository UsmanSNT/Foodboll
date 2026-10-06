import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ReceiptType = 'image/jpeg' | 'image/png' | 'application/pdf';

const EXTENSION: Record<ReceiptType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/** Where receipt files live. Keys are opaque and generated here, never derived from user input. */
export interface ReceiptStorage {
  put(bytes: Buffer, contentType: ReceiptType): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|pdf)$/;

/** Detects the real file type from its leading bytes; the client-declared type is not trusted. */
export function sniffReceiptType(bytes: Buffer): ReceiptType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

export function contentTypeForKey(key: string): ReceiptType | null {
  const ext = key.split('.').pop();
  return (
    (Object.entries(EXTENSION).find(([, e]) => e === ext)?.[0] as ReceiptType | undefined) ?? null
  );
}

/** Local-disk implementation. Swap for S3/GCS by implementing `ReceiptStorage`. */
export class LocalReceiptStorage implements ReceiptStorage {
  private readonly root: string;
  private ready: Promise<unknown> | null = null;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private pathFor(key: string): string | null {
    // The pattern admits no separators or dots beyond the extension, so no traversal is possible.
    return KEY_PATTERN.test(key) ? path.join(this.root, key) : null;
  }

  async put(bytes: Buffer, contentType: ReceiptType): Promise<string> {
    // Cache the directory creation, but never cache a failure: a missing volume that appears later
    // must not break uploads until the process restarts.
    this.ready ??= mkdir(this.root, { recursive: true, mode: 0o700 }).catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    await this.ready;
    const key = `${randomUUID()}.${EXTENSION[contentType]}`;
    const file = this.pathFor(key);
    if (!file) throw new Error('Generated an invalid receipt key');
    await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
    return key;
  }

  async get(key: string): Promise<Buffer | null> {
    const file = this.pathFor(key);
    if (!file) return null;
    try {
      return await readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.pathFor(key);
    if (file) await rm(file, { force: true });
  }
}
