import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { join } from 'path';

// O cliente é gerado fora de src para não ser duplicado no bundle do Nest.
// O caminho absoluto funciona tanto no modo watch quanto em dist.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require(
  join(process.cwd(), 'generated', 'prisma'),
) as typeof import('../../generated/prisma');

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
