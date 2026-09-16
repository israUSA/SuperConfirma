import postgres from 'postgres';

export type Q = postgres.TransactionSql;

/** Every request runs inside one transaction. Tests swap it for a savepoint that rolls back. */
export interface Db {
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
}

export function createDb(url: string): Db & { close(): Promise<void> } {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  return {
    tx: <T>(fn: (q: Q) => Promise<T>) => sql.begin(fn) as Promise<T>,
    close: () => sql.end(),
  };
}

export function pgCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export const EXCLUSION_VIOLATION = '23P01';
export const UNIQUE_VIOLATION = '23505';
