import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ConfigModule } from '@nestjs/config';
import { HealthService } from './health/health.service.js';
import { HealthController } from './health/health.controller.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import Joi from 'joi';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    ConfigModule.forRoot({
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().uri().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        KAFKA_BROKERS: Joi.string().default('localhost:9092'),
        DISABLE_OUTBOX_RELAY: Joi.boolean().default(false),
      }),
    }),
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    HealthService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
