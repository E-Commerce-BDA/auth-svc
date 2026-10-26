import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter.js';

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    path: '/api/v1/auth/login',
    url: '/api/v1/auth/login',
    originalUrl: '/api/v1/auth/login',
    method: 'POST',
    headers: { 'x-request-id': 'req-test' },
    ...overrides,
  } as unknown as Request;
}

function makeResponse(): {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

function makeHost(request: Request, response: object): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps a 401 in the shared envelope and echoes the request id', () => {
    const request = makeRequest();
    const response = makeResponse();

    filter.catch(
      new UnauthorizedException('Invalid email or password'),
      makeHost(request, response),
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Invalid email or password',
      },
      requestId: 'req-test',
      timestamp: expect.any(String),
    });
  });

  it('maps validation messages to VALIDATION_FAILED details', () => {
    const request = makeRequest();
    const response = makeResponse();

    filter.catch(
      new BadRequestException({
        message: ['email must be an email'],
        error: 'Bad Request',
        statusCode: 400,
      }),
      makeHost(request, response),
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: ['email must be an email'],
      },
      requestId: 'req-test',
      timestamp: expect.any(String),
    });
  });

  it('passes through an explicit code and details', () => {
    const request = makeRequest();
    const response = makeResponse();

    filter.catch(
      new ConflictException({
        code: 'EMAIL_EXISTS',
        message: 'Email already exists',
        details: { email: 'shopper@example.com' },
      }),
      makeHost(request, response),
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: 'EMAIL_EXISTS',
        message: 'Email already exists',
        details: { email: 'shopper@example.com' },
      },
      requestId: 'req-test',
      timestamp: expect.any(String),
    });
  });

  it('hides unexpected error details and generates a request id', () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const request = makeRequest({ headers: {} });
    const response = makeResponse();

    filter.catch(new Error('database password leaked'), makeHost(request, response));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      timestamp: expect.any(String),
    });
    expect(JSON.stringify(response.json.mock.calls[0][0])).not.toContain(
      'database password',
    );
    expect(log).toHaveBeenCalled();
  });

  it('keeps health readiness bodies outside the envelope', () => {
    const request = makeRequest({ path: '/health/ready', url: '/health/ready' });
    const response = makeResponse();

    filter.catch(
      new ServiceUnavailableException({
        status: 'not_ready',
        checks: { db: 'down' },
      }),
      makeHost(request, response),
    );

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      status: 'not_ready',
      checks: { db: 'down' },
    });
  });
});
