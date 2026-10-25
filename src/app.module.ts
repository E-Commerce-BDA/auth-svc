import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ConfigModule } from '@nestjs/config';
import { HealthService } from './health/health.service.js';
import { HealthController } from './health/health.controller.js';
import Joi from 'joi';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    ConfigModule.forRoot({
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().uri().required(),
        JWT_SECRET: Joi.string().min(32).required(),
      }),
    }),
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, HealthService],
})
export class AppModule {}
