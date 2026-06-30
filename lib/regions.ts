export const REGIONS = [
  'MOC NorCal', 'MOC SoCal', 'MOC PNW', 'MOC Central',
  'MOC Mid-Atlantic', 'MOC Canada', 'Other Distributors',
] as const;

const FULL_TO_ABBR: Record<string, string> = {
  california: 'CA', nevada: 'NV', oregon: 'OR', washington: 'WA', montana: 'MT', idaho: 'ID',
  colorado: 'CO', texas: 'TX', wyoming: 'WY', 'new mexico': 'NM', oklahoma: 'OK', louisiana: 'LA',
  mississippi: 'MS', 'north carolina': 'NC', 'south carolina': 'SC', virginia: 'VA', maryland: 'MD',
  'west virginia': 'WV', georgia: 'GA', indiana: 'IN', arizona: 'AZ', utah: 'UT', hawaii: 'HI',
};

const STATE_TO_REGION: Record<string, string> = {
  OR: 'MOC PNW', WA: 'MOC PNW', MT: 'MOC PNW', ID: 'MOC PNW',
  CO: 'MOC Central', TX: 'MOC Central', WY: 'MOC Central', NM: 'MOC Central',
  OK: 'MOC Central', LA: 'MOC Central', MS: 'MOC Central',
  NC: 'MOC Mid-Atlantic', SC: 'MOC Mid-Atlantic', VA: 'MOC Mid-Atlantic',
  MD: 'MOC Mid-Atlantic', WV: 'MOC Mid-Atlantic',
};
const CANADA = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK']);

// CA: NorCal = Bay Area & north (Salinas+); SoCal = LA & south. Central valley = ASK.
const CA_NORCAL = new Set(['san francisco', 'oakland', 'san jose', 'sacramento', 'salinas', 'santa rosa', 'berkeley', 'fremont', 'concord', 'modesto', 'stockton']);
const CA_SOCAL = new Set(['los angeles', 'san diego', 'irvine', 'anaheim', 'long beach', 'riverside', 'san bernardino', 'santa ana', 'pasadena', 'torrance']);
const CA_ASK = new Set(['fresno', 'bakersfield', 'visalia', 'merced', 'clovis']);

function abbr(state: string): string {
  const s = (state || '').trim();
  if (s.length === 2) return s.toUpperCase();
  return FULL_TO_ABBR[s.toLowerCase()] || s.toUpperCase();
}

export function detectRegion(state: string, city: string): string {
  const st = abbr(state);
  const c = (city || '').trim().toLowerCase();
  if (CANADA.has(st)) return 'MOC Canada';
  if (st === 'CA') {
    if (CA_ASK.has(c)) return 'ASK';
    if (CA_SOCAL.has(c)) return 'MOC SoCal';
    if (CA_NORCAL.has(c)) return 'MOC NorCal';
    return 'ASK';
  }
  if (st === 'NV') {
    if (c.includes('reno') || c.includes('sparks') || c.includes('carson')) return 'MOC NorCal';
    if (c.includes('vegas') || c.includes('henderson')) return 'MOC SoCal';
    return 'ASK';
  }
  if (STATE_TO_REGION[st]) return STATE_TO_REGION[st];
  const OTHER = new Set(['GA', 'IN', 'AZ', 'UT', 'HI', 'FL', 'OH', 'MI', 'PA', 'TN', 'KY', 'AL', 'MO', 'KS', 'NE', 'AR', 'SD', 'ND', 'MN', 'WI', 'IL', 'IA', 'NY', 'NJ', 'CT', 'MA', 'ME', 'NH', 'VT', 'RI', 'DE', 'AK']);
  if (OTHER.has(st)) return 'Other Distributors';
  return 'ASK';
}
