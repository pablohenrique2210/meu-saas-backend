import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { PrismaService } from '../prisma/prisma.service'; // 👈 Importa aqui

@Module({
  controllers: [CompaniesController],
  providers: [CompaniesService, PrismaService], // 👈 Coloca o PrismaService na lista!
})
export class CompaniesModule {}