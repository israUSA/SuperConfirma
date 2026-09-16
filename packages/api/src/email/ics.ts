export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  stamp: Date;
  summary: string;
  location?: string | null;
  description?: string;
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const escape = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 content lines are limited to 75 octets; continuation lines start with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString());
    start = end;
  }
  return parts.join('\r\n ');
}

export function buildIcs(event: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SuperConfirma//Reservas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}@superconfirma`,
    `DTSTAMP:${utc(event.stamp)}`,
    `DTSTART:${utc(event.start)}`,
    `DTEND:${utc(event.end)}`,
    `SUMMARY:${escape(event.summary)}`,
    ...(event.location ? [`LOCATION:${escape(event.location)}`] : []),
    ...(event.description ? [`DESCRIPTION:${escape(event.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
