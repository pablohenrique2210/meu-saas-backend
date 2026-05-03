import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Liberamos a comunicação com o Frontend
  app.enableCors(); 
  
  // Mudamos a porta de 3000 para 3333
  await app.listen(3333); 
}
bootstrap();