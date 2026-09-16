import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { Db, Q } from '../src/db.ts';
import { MemoryEmailSender } from '../src/email/sender.ts';

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

export const WEB = 'https://reservas.test';

// Seed (supabase/seed.sql)
export const SLUG = 'aura-estetica';
export const LOCATION = '00000000-0000-4000-c000-000000000001';
export const LIMPIEZA = '00000000-0000-4000-e000-000000000001';
export const BOTOX = '00000000-0000-4000-e000-000000000002';
export const VALORACION = '00000000-0000-4000-e000-000000000003';
export const DRA = '00000000-0000-4000-d000-000000000001';
export const LIC = '00000000-0000-4000-d000-000000000002';

/** Sunday evening in Quito, the week the tests book into. */
export const SUNDAY_EVENING = new Date('2026-10-19T01:00:00Z');

export interface Ctx {
  app: FastifyInstance;
  email: MemoryEmailSender;
  q: Q;
  clock: { now: Date };
  flush: () => Promise<void>;
  advance: (minutes: number) => void;
}

class Rollback extends Error {}

/** One app per test, bound to a transaction that is rolled back at the end. */
export async function withApp(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  try {
    await sql.begin(async (t) => {
      const tasks: Promise<unknown>[] = [];
      const email = new MemoryEmailSender();
      const clock = { now: SUNDAY_EVENING };
      const db: Db = { tx: (f) => t.savepoint(f) as never };
      const app = buildApp({
        db,
        email,
        now: () => clock.now,
        corsOrigins: [WEB],
        publicWebUrl: WEB,
        background: (task) => tasks.push(task),
      });
      await app.ready();
      try {
        await fn({
          app,
          email,
          q: t,
          clock,
          flush: async () => {
            await Promise.all(tasks.splice(0));
          },
          advance: (minutes) => {
            clock.now = new Date(clock.now.getTime() + minutes * 60_000);
          },
        });
      } finally {
        await Promise.all(tasks);
        await app.close();
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

export const tokenFrom = (manageUrl: string) => manageUrl.split('/').pop()!;

export async function hold(app: FastifyInstance, start: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: `/v1/public/${SLUG}/holds`,
    payload: { locationId: LOCATION, serviceId: LIMPIEZA, start, ...extra },
  });
}

export async function complete(app: FastifyInstance, token: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/public/holds/complete',
    payload: {
      token,
      name: 'Sofía Benítez',
      phone: '099 876 5432',
      email: 'sofia@example.com',
      consent: true,
      consentVersion: '2026-09-v1',
      ...extra,
    },
  });
}

/** Holds and completes a booking; returns its manage token. */
export async function book(app: FastifyInstance, start: string, extra: Record<string, unknown> = {}): Promise<string> {
  const held = await hold(app, start, extra);
  if (held.statusCode !== 201) throw new Error(`hold failed: ${held.body}`);
  const done = await complete(app, held.json().token);
  if (done.statusCode !== 200) throw new Error(`complete failed: ${done.body}`);
  return tokenFrom(done.json().manageUrl);
}

export async function availableStarts(app: FastifyInstance, date: string, serviceId = LIMPIEZA): Promise<string[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/public/${SLUG}/availability?locationId=${LOCATION}&serviceId=${serviceId}&from=${date}&to=${date}`,
  });
  return (res.json().slots as Array<{ start: string }>).map((s) => s.start);
}
