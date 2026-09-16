import { buildApp } from './app.ts';
import { createDb } from './db.ts';
import { MemoryEmailSender, ResendEmailSender, type EmailSender } from './email/sender.ts';

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
};

const db = createDb(env('DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'));
const publicWebUrl = env('PUBLIC_WEB_URL', 'http://localhost:4321');

let email: EmailSender;
if (process.env.RESEND_API_KEY) {
  email = new ResendEmailSender(process.env.RESEND_API_KEY, env('EMAIL_FROM'));
} else {
  email = new MemoryEmailSender();
  console.warn('RESEND_API_KEY no está definida: los correos se guardan en memoria y no se envían.');
}

const app = buildApp({
  db,
  email,
  now: () => new Date(),
  corsOrigins: env('CORS_ORIGINS', publicWebUrl).split(',').map((o) => o.trim()),
  publicWebUrl,
  logger: true,
});

const close = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ port: Number(env('PORT', '8787')), host: env('HOST', '127.0.0.1') });
