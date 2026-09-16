import { DateTime } from 'luxon';
import type { Db } from '../db.ts';
import { buildIcs } from './ics.ts';
import type { EmailSender } from './sender.ts';

const html = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Row {
  booking_id: string;
  business_id: string;
  business_name: string;
  customer_name: string;
  email: string | null;
  service_name: string | null;
  sensitive: boolean | null;
  resource_name: string | null;
  address: string | null;
  timezone: string;
  country: string;
  starts_at: Date;
  ends_at: Date;
}

/**
 * P3: the message_log row is written before sending, and its unique key makes a retry a no-op.
 * A failed email never undoes the booking (P12).
 */
export async function sendConfirmationEmail(
  db: Db,
  deps: { email: EmailSender; now: () => Date; manageUrl: (token: string) => string },
  bookingId: string,
  token: string,
): Promise<'sent' | 'skipped' | 'failed'> {
  const claimed = await db.tx(async (q) => {
    const [row] = await q<Row[]>`
      select b.id as booking_id, b.business_id, bz.name as business_name,
             c.name as customer_name, c.email,
             s.name as service_name, s.sensitive,
             r.name as resource_name,
             l.address, l.timezone, l.phone_country as country,
             lower(b.span) as starts_at, upper(b.span) as ends_at
      from booking b
      join business bz on bz.id = b.business_id
      join location l on l.id = b.location_id
      join customer c on c.id = b.customer_id
      left join service s on s.id = b.service_id
      left join lateral (
        select r.name from booking_resource br join resource r on r.id = br.resource_id
        where br.booking_id = b.id order by r.sort_order limit 1
      ) r on true
      where b.id = ${bookingId}`;
    if (!row?.email) return null;

    const [log] = await q<{ id: string }[]>`
      insert into message_log (business_id, booking_id, channel, kind, window_key, country, cost_estimate_micros)
      values (${row.business_id}, ${row.booking_id}, 'email', 'confirmation', 'initial', ${row.country}, 0)
      on conflict on constraint message_log_idempotency do nothing
      returning id`;
    return log ? { row, logId: log.id } : null;
  });
  if (!claimed) return 'skipped';

  const { row, logId } = claimed;
  const start = DateTime.fromJSDate(row.starts_at, { zone: row.timezone }).setLocale('es');
  const when = `${start.toFormat("cccc d 'de' LLLL")} a las ${start.toFormat('HH:mm')}`;
  const what = row.sensitive === false && row.service_name ? row.service_name : null;
  const manage = deps.manageUrl(token);

  const lines = [
    `Hola ${row.customer_name}, tu cita en ${row.business_name} quedó reservada.`,
    '',
    `Fecha: ${when}`,
    ...(row.resource_name ? [`Con: ${row.resource_name}`] : []),
    ...(what ? [`Servicio: ${what}`] : []),
    ...(row.address ? [`Lugar: ${row.address}`] : []),
    '',
    `Si necesitas cambiar o cancelar tu cita: ${manage}`,
  ];

  try {
    const result = await deps.email.send({
      to: row.email!,
      subject: `Tu cita en ${row.business_name} · ${start.toFormat('d LLL, HH:mm')}`,
      text: lines.join('\n'),
      html: lines.map((l) => (l ? `<p>${html(l)}</p>` : '')).join('\n'),
      attachments: [
        {
          filename: 'cita.ics',
          contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
          content: buildIcs({
            uid: row.booking_id,
            start: row.starts_at,
            end: row.ends_at,
            stamp: deps.now(),
            summary: `Cita en ${row.business_name}`,
            location: row.address,
            description: `Cambiar o cancelar: ${manage}`,
          }),
        },
      ],
    });
    await db.tx((q) => q`
      update message_log set status = 'sent', sent_at = ${deps.now()}, provider_msg_id = ${result.providerId}
      where id = ${logId}`);
    return 'sent';
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 200) : 'unknown';
    await db.tx((q) => q`update message_log set status = 'failed', error = ${reason} where id = ${logId}`);
    return 'failed';
  }
}
