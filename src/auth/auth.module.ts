import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createOutboxModule } from '@ecom/messaging/nest';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from './auth.constants.js';
import { getPool } from '../db/pool.js';
import { AuthOutbox } from '../outbox/auth-outbox.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '15m',
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          algorithm: JWT_ALGORITHM,
        },
      }),
    }),
    // Everything the outbox needs (claim SQL, leases, retries, envelope) lives
    // in the package; auth-svc only names its schema and producer.
    createOutboxModule({
      schema: 'auth',
      producer: 'auth-svc',
      clientId: 'auth-svc',
      pool: getPool,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthOutbox],
  exports: [JwtModule],
})
export class AuthModule {}
