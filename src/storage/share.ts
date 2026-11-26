/**
 * Share a design as a link: the design JSON is deflated and base64url-encoded into the
 * URL hash (#d=...), so no server is needed. Opening the link imports a copy.
 */
import type { DesignFile } from '../model/design';

const PREFIX = '#d=';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeDesign(file: DesignFile): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(file));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeDesign(code: string): Promise<unknown> {
  const bytes = await pipe(fromBase64Url(code), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function shareUrl(file: DesignFile, base = location.href): Promise<string> {
  const url = new URL(base);
  url.hash = PREFIX.slice(1) + (await encodeDesign(file));
  return url.toString();
}

/** The shared design code in a URL hash, if any. */
export function sharedCode(hash = location.hash): string | null {
  return hash.startsWith(PREFIX) ? hash.slice(PREFIX.length) : null;
}
