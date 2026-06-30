import { sql } from '@/lib/db';

// Request participants linked to a dealership/group. `kind` is classified by
// email domain — internal MOC/EZ-Wins people (the requester + any MOC employee)
// are `moc`; everyone else (the dealer's own staff) is `dealer`. A caller may
// pass an explicit `kind` to override the domain heuristic.

const MOC_DOMAINS = new Set(['ez-wins.com', 'mocproducts.com']);

export interface Contact {
  id: number;
  dealership_id: string | null;
  group_id: string | null;
  name: string | null;
  email: string | null;
  kind: string;       // moc | dealer
  source: string | null;
  created_at: string;
}

export function classifyKind(email: string): 'moc' | 'dealer' {
  const domain = (email.split('@')[1] || '').trim().toLowerCase();
  return MOC_DOMAINS.has(domain) ? 'moc' : 'dealer';
}

export async function addContacts(input: {
  dealership_id?: string | null;
  group_id?: string | null;
  source?: string | null;
  people: { name?: string; email: string; kind?: 'moc' | 'dealer' }[];
}): Promise<Contact[]> {
  const out: Contact[] = [];
  for (const p of input.people) {
    if (!p.email) continue;
    const kind = p.kind || classifyKind(p.email);
    const rows = (await sql`
      insert into contact (dealership_id, group_id, name, email, kind, source)
      values (${input.dealership_id || null}, ${input.group_id || null}, ${p.name || null},
              ${p.email}, ${kind}, ${input.source || null})
      returning *
    `) as Contact[];
    out.push(rows[0]);
  }
  return out;
}

export async function listContacts(dealershipId: string, kind?: 'moc' | 'dealer'): Promise<Contact[]> {
  if (kind) {
    return (await sql`
      select * from contact where dealership_id = ${dealershipId} and kind = ${kind} order by id asc
    `) as Contact[];
  }
  return (await sql`select * from contact where dealership_id = ${dealershipId} order by id asc`) as Contact[];
}

// Parse "Name <email>" or "email" lines (one per line) into people for addContacts.
export function parseContactLines(text: string): { name?: string; email: string }[] {
  return (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.*?)[<(]?\s*([\w.+-]+@[\w.-]+\.\w+)\s*[>)]?$/);
      if (!m) return null;
      const name = m[1].trim().replace(/[,:-]\s*$/, '');
      return { name: name || undefined, email: m[2] };
    })
    .filter(Boolean) as { name?: string; email: string }[];
}
