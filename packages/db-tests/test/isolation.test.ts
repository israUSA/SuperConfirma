import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asAnon, asPanelUser, asSuperuser, createTenant, errorCode, inTx, sql, type Tx, first } from './helpers.ts';

/**
 * P1: every table in `public` must be listed here with how it is isolated.
 * A new table without an entry turns CI red.
 */
const REGISTRY = {
  business: 'tenant_root',
  location: 'tenant_rw',
  resource: 'tenant_rw',
  service: 'tenant_rw',
  service_resource: 'tenant_rw',
  availability_rule: 'tenant_rw',
  availability_exception: 'tenant_rw',
  customer: 'tenant_rw',
  booking: 'tenant_rw',
  booking_resource: 'tenant_rw',
  webhook_endpoint: 'tenant_rw',
  consent: 'tenant_ro',
  wa_account: 'tenant_ro',
  wa_template_status: 'tenant_ro',
  message_log: 'tenant_ro',
  webhook_delivery: 'tenant_ro',
  message_template: 'global_read',
  account: 'internal',
  contact_identity: 'internal',
} as const satisfies Record<string, 'tenant_root' | 'tenant_rw' | 'tenant_ro' | 'global_read' | 'internal'>;

type Table = keyof typeof REGISTRY;
const TABLES = Object.keys(REGISTRY) as Table[];
const tenantTables = TABLES.filter((t) => REGISTRY[t].startsWith('tenant'));
const tenantColumn = (t: Table) => (REGISTRY[t] === 'tenant_root' ? 'id' : 'business_id');

afterAll(() => sql.end());

async function withTwoTenants(fn: (tx: Tx, a: string, b: string) => Promise<void>) {
  await inTx(async (tx) => {
    const a = await createTenant(tx, 'Negocio A');
    const b = await createTenant(tx, 'Negocio B');
    await fn(tx, a.businessId, b.businessId);
  });
}

describe('registro de tablas', () => {
  it('toda tabla de public está registrada, y no sobra ninguna', async () => {
    const rows = await sql<{ name: string }[]>`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`;
    expect(rows.map((r) => r.name).sort()).toEqual([...TABLES].sort());
  });

  it('toda tabla de public tiene RLS activada', async () => {
    const rows = await sql<{ name: string }[]>`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`;
    expect(rows).toEqual([]);
  });

  it('las tablas de negocio tienen su columna de tenant', async () => {
    for (const t of tenantTables) {
      const [row] = await sql`
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = ${t} and column_name = ${tenantColumn(t)} and is_nullable = 'NO'`;
      expect(row, `${t}.${tenantColumn(t)}`).toBeDefined();
    }
  });
});

describe('aislamiento entre negocios (P1)', () => {
  it.each(tenantTables)('%s: el negocio A no ve filas de ningún otro negocio', async (t) => {
    await withTwoTenants(async (tx, a, b) => {
      const col = tenantColumn(t);
      const { n: seeded } = first(await tx`select count(*)::int as n from ${tx(t)} where ${tx(col)} = ${b}`);
      expect(seeded, 'el fixture debe tener datos de B').toBeGreaterThan(0);

      await asPanelUser(tx, [a]);
      const { others } = first(await tx`select count(*)::int as others from ${tx(t)} where ${tx(col)} <> ${a}`);
      const { own } = first(await tx`select count(*)::int as own from ${tx(t)} where ${tx(col)} = ${a}`);
      expect(others).toBe(0);
      expect(own, 'A debe poder ver lo suyo, si no el test pasa en vacío').toBeGreaterThan(0);
    });
  });

  it.each(tenantTables)('%s: el negocio A no modifica ni borra filas de B', async (t) => {
    await withTwoTenants(async (tx, a, b) => {
      const col = tenantColumn(t);
      await asPanelUser(tx, [a]);
      const updated = await tx`update ${tx(t)} set ${tx(col)} = ${tx(col)} where ${tx(col)} = ${b}`;
      const deleted = await tx`delete from ${tx(t)} where ${tx(col)} = ${b}`;
      expect(updated.count).toBe(0);
      expect(deleted.count).toBe(0);

      await asSuperuser(tx);
      const { n } = first(await tx`select count(*)::int as n from ${tx(t)} where ${tx(col)} = ${b}`);
      expect(n).toBeGreaterThan(0);
    });
  });

  it.each(tenantTables)('%s: el negocio A no inserta filas a nombre de B', async (t) => {
    await withTwoTenants(async (tx, a, b) => {
      const col = tenantColumn(t);
      const { row } = first(await tx`select to_jsonb(x) as row from ${tx(t)} x where ${tx(col)} = ${b} limit 1`);
      const copy = { ...(row as Record<string, unknown>) };
      if ('id' in copy && col !== 'id') copy.id = randomUUID();

      await asPanelUser(tx, [a]);
      const code = await errorCode(tx, (sp) =>
        sp`insert into ${sp(t)} select * from jsonb_populate_record(null::${sp(t)}, ${sp.json(copy as never)})`,
      );
      // 42501 = RLS; 23503 = para A el padre de B no existe. Ambos son rechazo.
      expect(['42501', '23503']).toContain(code);
    });
  });

  it('A no puede mover una fila propia hacia B', async () => {
    await withTwoTenants(async (tx, a, b) => {
      await asPanelUser(tx, [a]);
      const code = await errorCode(tx, (sp) => sp`update customer set business_id = ${b} where business_id = ${a}`);
      expect(code).toBe('42501');
    });
  });

  it('un usuario de agencia ve sus negocios y nada más', async () => {
    await inTx(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const c = await createTenant(tx, 'C');
      await asPanelUser(tx, [a.businessId, b.businessId]);
      const rows = await tx<{ business_id: string }[]>`select distinct business_id from booking`;
      expect(rows.map((r) => r.business_id).sort()).toEqual([a.businessId, b.businessId].sort());
      expect(rows.map((r) => r.business_id)).not.toContain(c.businessId);
    });
  });

  it('un JWT sin negocios no ve nada', async () => {
    await withTwoTenants(async (tx) => {
      await asPanelUser(tx, []);
      for (const t of tenantTables) {
        const { n } = first(await tx`select count(*)::int as n from ${tx(t)}`);
        expect(n, t).toBe(0);
      }
    });
  });
});

describe('tablas internas y permisos peligrosos', () => {
  it.each(TABLES.filter((t) => REGISTRY[t] === 'internal'))('%s: inaccesible desde el panel', async (t) => {
    await withTwoTenants(async (tx, a) => {
      await asPanelUser(tx, [a]);
      expect(await errorCode(tx, (sp) => sp`select * from ${sp(t)} limit 1`)).toBe('42501');
    });
  });

  it('message_template: el panel lee pero no escribe', async () => {
    await withTwoTenants(async (tx, a) => {
      await asPanelUser(tx, [a]);
      const rows = await tx`select id from message_template limit 1`;
      expect(rows.length).toBe(1);
      expect(await errorCode(tx, (sp) => sp`insert into message_template (key, version, body) values ('x', 1, 'x')`)).toBe('42501');
      const updated = await tx`update message_template set body = 'hackeado'`;
      expect(updated.count).toBe(0);
    });
  });

  it('el panel no puede leer el secreto de firma de los webhooks', async () => {
    await withTwoTenants(async (tx, a) => {
      await asPanelUser(tx, [a]);
      expect(await errorCode(tx, (sp) => sp`select secret from webhook_endpoint`)).toBe('42501');
      const rows = await tx`select id, url from webhook_endpoint`;
      expect(rows.length).toBe(1);
    });
  });

  it.each(TABLES)('%s: el panel no puede hacer TRUNCATE (se salta RLS)', async (t) => {
    await withTwoTenants(async (tx, a) => {
      await asPanelUser(tx, [a]);
      expect(await errorCode(tx, (sp) => sp`truncate ${sp(t)} cascade`)).toBe('42501');
    });
  });

  it.each(TABLES)('%s: anon no tiene acceso (P4)', async (t) => {
    await withTwoTenants(async (tx) => {
      await asAnon(tx);
      expect(await errorCode(tx, (sp) => sp`select 1 from ${sp(t)} limit 1`)).toBe('42501');
    });
  });

  it('el panel no puede ejecutar funciones internas', async () => {
    await withTwoTenants(async (tx, a) => {
      await asPanelUser(tx, [a]);
      expect(await errorCode(tx, (sp) => sp`select app_private.expire_holds()`)).toBe('42501');
    });
  });
});
