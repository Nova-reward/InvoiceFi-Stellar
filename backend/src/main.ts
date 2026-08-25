import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { UnauthorizedExceptionFilter } from './common/unauthorized.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 4000);
  
  // Register global exception filters
  app.useGlobalFilters(new UnauthorizedExceptionFilter());
  
  await app.listen(port);
  new Logger('Bootstrap').log(`Backend listening on port ${port}`);
}

void bootstrap();
