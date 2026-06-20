import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('InvoiceFi Stellar API')
    .setDescription('Decentralized harvest invoice financing protocol on Stellar')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentication')
    .addTag('invoices', 'Invoice management')
    .addTag('financing-pool', 'Liquidity pool & invoice funding')
    .addTag('settlement', 'Repayment & settlement')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  if (process.env.NODE_ENV !== 'production') {
    writeFileSync('./openapi.json', JSON.stringify(document, null, 2));
  }

  await app.listen(process.env.PORT ?? 4000);
}

bootstrap();
