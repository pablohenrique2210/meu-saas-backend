import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express'; // Necessário para configurar os limites
import { isAllowedFrontendOrigin } from './config/frontend-origins';

async function bootstrap() {
  const app = await NestFactory.create<any>(AppModule);
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('A variável PORT precisa conter uma porta válida.');
  }

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.enableCors({
    origin(origin, callback) {
      // Requisições sem Origin incluem health checks e chamadas servidor-servidor.
      if (
        !origin ||
        isAllowedFrontendOrigin(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origem não permitida pelo CORS: ${origin}`), false);
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });

  // Permitir uploads de vídeos de até 2 GB
  app.use(express.json({ limit: '2000mb' }));
  app.use(express.urlencoded({ limit: '2000mb', extended: true }));

  await app.listen(port);
  console.log(`API disponível em http://localhost:${port}/api`);
}
bootstrap();
