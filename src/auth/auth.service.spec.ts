import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import { JwtService } from '@nestjs/jwt';
import { vi } from 'vitest';
import { AuthOutbox } from '../outbox/auth-outbox.js';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: { signAsync: vi.fn() },
        },
        {
          provide: AuthOutbox,
          useValue: { recordUserRegistered: vi.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
