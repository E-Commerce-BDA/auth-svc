import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 4010 is the auth-svc port in the architecture docs (1.Architecture.md,
  // 4.API-Design.md) and the port nginx routes /api/auth/* to.
  const port = process.env.PORT ?? 4010;
  await app.listen(port);
}
await bootstrap();
