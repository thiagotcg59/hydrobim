import { fail, ok, type IfcSource, type Result } from '@hydrobim/core';

/**
 * Empacotamento do arquivo-fonte para o projeto: gzip + base64, com o SHA-256 do arquivo
 * original. A compactação não altera o conteúdo — `unpackIfcSource` devolve os mesmos bytes
 * e confere o resumo. Usa só APIs padrão (CompressionStream e Web Crypto), presentes no
 * navegador, em Web Workers e no Node.
 */

async function pipe(bytes: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function packIfcSource(fileName: string, bytes: Uint8Array): Promise<IfcSource> {
  const [sha256, compressed] = await Promise.all([
    sha256Hex(bytes),
    pipe(bytes, new CompressionStream('gzip')),
  ]);
  return {
    fileName,
    byteLength: bytes.byteLength,
    sha256,
    encoding: 'gzip-base64',
    data: bytesToBase64(compressed),
  };
}

export async function unpackIfcSource(source: IfcSource): Promise<Result<Uint8Array>> {
  if (source.data === '') {
    return fail(
      'IFC_SOURCE_MISSING',
      `O arquivo-fonte "${source.fileName}" não está disponível neste projeto. Religue o arquivo original.`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await pipe(base64ToBytes(source.data), new DecompressionStream('gzip'));
  } catch {
    return fail(
      'IFC_SOURCE_CORRUPT',
      `O arquivo-fonte "${source.fileName}" guardado no projeto está corrompido.`,
    );
  }
  if (bytes.byteLength !== source.byteLength || (await sha256Hex(bytes)) !== source.sha256) {
    return fail(
      'IFC_SOURCE_CORRUPT',
      `O arquivo-fonte "${source.fileName}" guardado no projeto não confere com o original (resumo SHA-256 diferente).`,
    );
  }
  return ok(bytes);
}
