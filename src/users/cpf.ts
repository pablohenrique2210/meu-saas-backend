import { createHmac, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';

export function normalizeCpf(value: string) {
  return value.replace(/\D/g, '');
}

export function assertValidCpf(value: string) {
  const cpf = normalizeCpf(value);

  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    throw new BadRequestException('Informe um CPF válido.');
  }

  const calculateDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  if (
    calculateDigit(9) !== Number(cpf[9]) ||
    calculateDigit(10) !== Number(cpf[10])
  ) {
    throw new BadRequestException('Informe um CPF válido.');
  }

  return cpf;
}

export function hashCpf(cpf: string) {
  const secret = process.env.CPF_HASH_SECRET ?? process.env.CLERK_SECRET_KEY;
  if (!secret) {
    throw new InternalServerErrorException(
      'A proteção dos dados de cadastro não está configurada.',
    );
  }

  return createHmac('sha256', secret).update(cpf).digest('hex');
}

export function cpfHashesMatch(first: string, second: string) {
  const firstBuffer = Buffer.from(first, 'hex');
  const secondBuffer = Buffer.from(second, 'hex');
  return (
    firstBuffer.length === secondBuffer.length &&
    timingSafeEqual(firstBuffer, secondBuffer)
  );
}
