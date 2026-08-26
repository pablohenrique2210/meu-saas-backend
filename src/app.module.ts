import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ContentModule } from './modules/content/content.module';
import { UsersModule } from './users/users.module';
import { ReportsModule } from './reports/reports.module';
import { GamesModule } from './games/games.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { uploadsRootPath } from './config/storage';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // 🚀 A magia para ler os teus vídeos e imagens
    ServeStaticModule.forRoot({
      rootPath: uploadsRootPath(),
      serveRoot: '/uploads',
    }),

    // 👇 O teu módulo de conteúdo
    ContentModule,
    UsersModule,
    ReportsModule,
    GamesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
