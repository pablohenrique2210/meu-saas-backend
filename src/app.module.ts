import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // 👈 1. Importa aqui
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';

@Module({
  imports: [
    ConfigModule.forRoot(), // 👈 2. Adiciona isto como o PRIMEIRO da lista!
    UsersModule,
    CompaniesModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}