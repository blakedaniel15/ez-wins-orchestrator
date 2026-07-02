import { getPortalTeam } from '@/lib/portal';

// Derive a dealer's region from the MOC rep who introduced them — the rep drives
// the region connection (per the onboarding model), so when an intro email has no
// address we can still route the region. Matches by email first, then by last name
// (some directory entries — e.g. GSMs — have no email on file).

function lastName(name: string): string {
  const parts = (name || '').trim().split(/[\s/]+/).filter(Boolean);
  return (parts[parts.length - 1] || '').toLowerCase();
}

export async function regionForRep(email?: string | null, name?: string | null): Promise<string | null> {
  let team;
  try {
    team = await getPortalTeam();
  } catch {
    return null; // fail-open — no region rather than blocking onboarding
  }
  const all = [...(team.gsms || []), ...(team.rsms || []), ...(team.ams || [])];
  const e = (email || '').trim().toLowerCase();
  if (e) {
    const byEmail = all.find((m) => (m.email || '').trim().toLowerCase() === e);
    if (byEmail?.region) return byEmail.region;
  }
  const ln = lastName(name || '');
  if (ln) {
    const byName = all.find((m) => (m.name || '').toLowerCase().split(/[\s/]+/).includes(ln));
    if (byName?.region) return byName.region;
  }
  return null;
}
