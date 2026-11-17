const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
const UUID = /^(?:[\da-f]{32}|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i;

/** Compressão dos 128 bits do UUID, na ordem canônica, para o alfabeto IFC. */
export function toIfcGuid(uuid: string): string {
  if (!UUID.test(uuid)) throw new Error('UUID inválido para conversão em GlobalId IFC.');
  let value = BigInt(`0x${uuid.replaceAll('-', '')}`);
  let result = '';
  for (let i = 0; i < 22; i += 1) {
    result = ALPHABET[Number(value & 63n)] + result;
    value >>= 6n;
  }
  return result;
}

const rotateLeft = (value: number, bits: number): number =>
  (value << bits) | (value >>> (32 - bits));

/** SHA-1 síncrono para UUID v5; identidade estável, sem finalidade criptográfica. */
function sha1(input: Uint8Array): Uint8Array {
  const data = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  data.set(input);
  data[input.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setBigUint64(data.length - 8, BigInt(input.length) * 8n);
  const hash = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  const words = new Int32Array(80);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 80; i += 1) {
      words[i] = rotateLeft(
        (words[i - 3] ?? 0) ^ (words[i - 8] ?? 0) ^ (words[i - 14] ?? 0) ^ (words[i - 16] ?? 0),
        1,
      );
    }
    let a = hash[0] ?? 0;
    let b = hash[1] ?? 0;
    let c = hash[2] ?? 0;
    let d = hash[3] ?? 0;
    let e = hash[4] ?? 0;
    for (let i = 0; i < 80; i += 1) {
      const f =
        i < 20
          ? (b & c) | (~b & d)
          : i < 40
            ? b ^ c ^ d
            : i < 60
              ? (b & c) | (b & d) | (c & d)
              : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const next = (rotateLeft(a, 5) + f + e + k + (words[i] ?? 0)) | 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = next;
    }
    [a, b, c, d, e].forEach((value, i) => {
      hash[i] = (hash[i] ?? 0) + value;
    });
  }
  const result = new Uint8Array(20);
  const resultView = new DataView(result.buffer);
  hash.forEach((value, i) => resultView.setUint32(i * 4, value));
  return result;
}

/** UUID v5 no namespace nulo, com prefixo HydroBIM, comprimido em GlobalId IFC. */
export function derivedGuid(seed: string): string {
  const name = new TextEncoder().encode(`HydroBIM:${seed}`);
  const input = new Uint8Array(16 + name.length);
  input.set(name, 16);
  const bytes = sha1(input).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return toIfcGuid(Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''));
}

/** Projetos antigos aceitam IDs textuais; preserva-se sua identidade sem inventar UUIDs aleatórios. */
export function persistentGuid(id: string): string {
  return UUID.test(id) ? toIfcGuid(id) : derivedGuid(`${id}:legacy`);
}
