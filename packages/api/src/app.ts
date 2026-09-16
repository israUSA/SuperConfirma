import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateSlots, groupSlotsByStart } from '@superconfirma/core';
import { z } from 'zod';
import { cancelManaged, completeHold, createHold, getManaged, rescheduleManaged } from './bookings.ts';
import { findBusiness, findLocation, loadAvailabilityQuery, publicCatalog } from './catalog.ts';
import type { Db } from './db.ts';
import { sendConfirmationEmail } from './email/confirmation.ts';
import type { EmailSender } from './email/sender.ts';
import { ApiError, parse } from './errors.ts';
import { TOKEN_PATTERN } from './tokens.ts';

export interface AppDeps {
  db: Db;
  email: EmailSender;
  now: () => Date;
  /** Origins of our own public page and widget iframe. The API is not called from customer sites. */
  corsOrigins: string[];
  publicWebUrl: string;
  logger?: boolean;
  rateLimitPerMinute?: number;
  /** Work that must not delay the response. Tests pass a collector and await it. */
  background?: (task: Promise<unknown>) => void;
}

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80);
const token = z.string().regex(TOKEN_PATTERN);
const source = z.enum(['widget', 'page']).default('page');

const holdBody = z.object({
  locationId: z.guid(),
  serviceId: z.guid(),
  resourceId: z.guid().optional(),
  start: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  source,
});

const completeBody = z.object({
  token,
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(25),
  email: z.email().max(200).optional(),
  consent: z.literal(true),
  consentVersion: z.string().max(40),
  source,
  // Honeypot: invisible to people, filled by naive bots.
  website: z.string().max(0).optional(),
});

const availabilityQuery = z.object({
  locationId: z.guid(),
  serviceId: z.guid(),
  resourceId: z.guid().optional(),
  from: z.iso.date(),
  to: z.iso.date(),
});

const rescheduleBody = z.object({
  start: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  resourceId: z.guid().optional(),
});

/** P7: manage tokens are credentials; they never reach the logs. */
export const maskUrl = (url: string) => url.replace(/(\/v1\/manage\/)[^/?]+/, '$1***');

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger
      ? {
          serializers: {
            req: (req) => ({ method: req.method, url: maskUrl(req.url) }),
          },
        }
      : false,
    trustProxy: true,
    bodyLimit: 16 * 1024,
  });

  app.register(cors, { origin: deps.corsOrigins, methods: ['GET', 'POST'] });
  app.register(rateLimit, { max: deps.rateLimitPerMinute ?? 120, timeWindow: '1 minute' });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.status).send({ error: error.code, details: error.details });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: 'rate_limited' });
    if (status && status < 500) return reply.status(status).send({ error: 'invalid_request' });
    req.log.error({ err: { message: error instanceof Error ? error.message : 'unknown' } }, 'unhandled');
    return reply.status(500).send({ error: 'internal' });
  });

  const manageUrl = (t: string) => `${deps.publicWebUrl}/gestionar/${t}`;
  const confirmLater = (bookingId: string, t: string, log: FastifyInstance['log']) => {
    const task = sendConfirmationEmail(deps.db, { email: deps.email, now: deps.now, manageUrl }, bookingId, t).catch(() =>
      log.error('confirmation email could not be recorded'),
    );
    deps.background?.(task);
  };

  // Routes live in a plugin so they are declared after rate-limit has loaded;
  // otherwise per-route limits are silently ignored.
  app.register(async (api) => {
    api.get('/health', async () => ({ ok: true }));

    api.get('/v1/public/:slug', async (req) => {
      const params = parse(z.object({ slug }), req.params);
      return deps.db.tx(async (q) => publicCatalog(q, await findBusiness(q, params.slug)));
    });

    api.get('/v1/public/:slug/availability', async (req) => {
      const params = parse(z.object({ slug }), req.params);
      const query = parse(availabilityQuery, req.query);
      return deps.db.tx(async (q) => {
        const business = await findBusiness(q, params.slug);
        const location = await findLocation(q, business.id, query.locationId);
        const input = await loadAvailabilityQuery(q, {
          businessId: business.id,
          location,
          serviceId: query.serviceId,
          resourceId: query.resourceId,
          fromDate: query.from,
          toDate: query.to,
          now: deps.now(),
        });
        return {
          timezone: location.timezone,
          slots: groupSlotsByStart(generateSlots(input)).map((g) => ({
            start: new Date(g.start).toISOString(),
            options: g.options.map((o) => ({ resourceId: o.resourceId, end: new Date(o.end).toISOString() })),
          })),
        };
      });
    });

    api.post('/v1/public/:slug/holds', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const params = parse(z.object({ slug }), req.params);
      const body = parse(holdBody, req.body);
      const held = await createHold(deps.db, deps.now(), { slug: params.slug, ...body });
      return reply.status(201).send(held);
    });

    api.post('/v1/public/holds/complete', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
      const body = parse(completeBody, req.body);
      const done = await completeHold(deps.db, deps.now(), {
        token: body.token,
        name: body.name,
        phone: body.phone,
        email: body.email,
        consentVersion: body.consentVersion,
        source: body.source,
        ip: req.ip ?? null,
      });
      if (!done.alreadyCompleted) confirmLater(done.bookingId, body.token, req.log);
      return { bookingId: done.bookingId, status: done.status, manageUrl: manageUrl(body.token) };
    });

    api.get('/v1/manage/:token', async (req) => {
      const params = parse(z.object({ token }), req.params);
      return getManaged(deps.db, deps.now(), params.token);
    });

    api.post('/v1/manage/:token/cancel', async (req) => {
      const params = parse(z.object({ token }), req.params);
      return cancelManaged(deps.db, deps.now(), params.token);
    });

    api.post('/v1/manage/:token/reschedule', async (req) => {
      const params = parse(z.object({ token }), req.params);
      const body = parse(rescheduleBody, req.body);
      const moved = await rescheduleManaged(deps.db, deps.now(), params.token, body);
      confirmLater(moved.id, moved.token, req.log);
      const { token: newToken, ...booking } = moved;
      return { ...booking, manageUrl: manageUrl(newToken) };
    });

  });

  return app;
}

