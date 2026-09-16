export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ providerId: string | null }>;
}

/** Development and tests: keeps messages in memory instead of sending them. */
export class MemoryEmailSender implements EmailSender {
  readonly outbox: EmailMessage[] = [];
  failNext = false;

  async send(message: EmailMessage) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated provider failure');
    }
    this.outbox.push(message);
    return { providerId: `memory-${this.outbox.length}` };
  }
}

export class ResendEmailSender implements EmailSender {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, from: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.from = from;
    this.fetchImpl = fetchImpl;
  }

  async send(message: EmailMessage) {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content).toString('base64'),
          content_type: a.contentType,
        })),
      }),
    });
    if (!response.ok) throw new Error(`resend responded ${response.status}`);
    const body = (await response.json()) as { id?: string };
    return { providerId: body.id ?? null };
  }
}
