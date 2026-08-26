import { BadRequestException } from '@nestjs/common';
import { assertValidCpf, cpfHashesMatch, hashCpf } from './cpf';

describe('CPF protection', () => {
  beforeEach(() => {
    process.env.CPF_HASH_SECRET = 'unit-test-cpf-secret';
  });

  it('normalizes and validates a CPF with punctuation', () => {
    expect(assertValidCpf('529.982.247-25')).toBe('52998224725');
  });

  it('rejects invalid and repeated CPFs', () => {
    expect(() => assertValidCpf('111.111.111-11')).toThrow(BadRequestException);
    expect(() => assertValidCpf('529.982.247-24')).toThrow(BadRequestException);
  });

  it('creates a deterministic non-readable hash', () => {
    const first = hashCpf('52998224725');
    const second = hashCpf('52998224725');

    expect(first).not.toContain('52998224725');
    expect(cpfHashesMatch(first, second)).toBe(true);
    expect(cpfHashesMatch(first, hashCpf('16899535009'))).toBe(false);
  });
});
