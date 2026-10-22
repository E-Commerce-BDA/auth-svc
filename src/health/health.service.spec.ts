import { Test, TestingModule } from '@nestjs/testing';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { HealthService } from './health.service.js';
import { getPool } from '../db/pool.js';

vi.mock('../db/pool.js', () => ({
  getPool: vi.fn(),
}));

const mockedGetPool = vi.mocked(getPool);

describe('HealthService', () => {
  let service: HealthService;
  let query: ReturnType<typeof vi.fn>;
  let loggerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HealthService],
    }).compile();

    service = module.get<HealthService>(HealthService);

    query = vi.fn();
    mockedGetPool.mockReturnValue({ query } as unknown as Pool);

    // The failure path logs the real driver error on purpose; keep the test
    // output clean and assert on the spy instead of the console.
    loggerSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns healthy when the database answers', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    await expect(service.checkDatabaseConnection()).resolves.toEqual({
      status: 'healthy',
    });
  });

  it('throws 503 when the database is unreachable', async () => {
    query.mockRejectedValue(new Error('connection refused'));

    await expect(service.checkDatabaseConnection()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('never leaks the database error to the caller', async () => {
    query.mockRejectedValue(new Error('password authentication failed'));

    const error = await service
      .checkDatabaseConnection()
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const response = (error as ServiceUnavailableException).getResponse() as {
      message: string;
      statusCode: number;
    };
    expect(response.statusCode).toBe(503);
    expect(response.message).toBe('Database connection failed');
    expect(response.message).not.toContain('password');
  });

  it('logs the underlying database error for the operator', async () => {
    query.mockRejectedValue(new Error('connection refused'));

    await expect(service.checkDatabaseConnection()).rejects.toThrow(
      ServiceUnavailableException,
    );

    expect(loggerSpy).toHaveBeenCalledWith(
      'Database connection failed',
      expect.stringContaining('connection refused'),
    );
  });
});
