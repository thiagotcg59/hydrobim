/// <reference types="node" />
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { derivedGuid, toIfcGuid } from './guid';

describe('GlobalId IFC', () => {
  it('comprime vetores conhecidos na ordem de bytes canônica', () => {
    expect(toIfcGuid('00000000-0000-0000-0000-000000000000')).toBe('0000000000000000000000');
    expect(toIfcGuid('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe('3$$$$$$$$$$$$$$$$$$$$$');
    expect(toIfcGuid('00112233-4455-6677-8899-aabbccddeeff')).toBe('004I8pH5LcTuYPghlCtUx$');
    expect(toIfcGuid('00112233445566778899AABBCCDDEEFF')).toBe('004I8pH5LcTuYPghlCtUx$');
  });

  it('rejeita UUIDs malformados', () => {
    for (const input of ['', 'project-id', 'ffffffff-ffff-ffff-ffff-fffffffffffz']) {
      expect(() => toIfcGuid(input)).toThrow('UUID inválido');
    }
  });

  it('deriva UUID v5 estável e confere SHA-1 com uma implementação independente', () => {
    for (const seed of ['id:site', 'água:porta', 'x'.repeat(300)]) {
      const digest = createHash('sha1')
        .update(new Uint8Array(16))
        .update(`HydroBIM:${seed}`)
        .digest();
      digest[6] = (digest[6]! & 0x0f) | 0x50;
      digest[8] = (digest[8]! & 0x3f) | 0x80;
      expect(derivedGuid(seed)).toBe(toIfcGuid(digest.subarray(0, 16).toString('hex')));
      expect(derivedGuid(seed)).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
    }
    expect(new Set(Array.from({ length: 1000 }, (_, i) => derivedGuid(`element:${i}`))).size).toBe(
      1000,
    );
  });
});
