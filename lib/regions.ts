// Region detection — outputs the EZ Wins PORTAL taxonomy (the single source of
// truth, from ez-wins-portal REGIONS_TABLE). The same value is written to the
// portal dealer AND the ClickUp "MOC Region" field, so there is one vocabulary
// across systems. 'ASK' means ambiguous/unknown → goes to the review queue,
// never written to the portal (which would create a junk region entry).

export const REGIONS = [
  'Canada', 'Central', 'Colorado', 'Iowa', 'NorCal', 'Northeast',
  'Other', 'PNW', 'SoCal', 'Southeast', 'Utah', 'Distrubitor (Non-MOC)',
] as const;

const FULL_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

// State → portal region. CA and NV are resolved by city (below), not here.
const STATE_TO_REGION: Record<string, string> = {
  // PNW
  OR: 'PNW', WA: 'PNW', MT: 'PNW', ID: 'PNW',
  // Central (Austin/DFW/Houston/Louisiana are its portal sub-regions)
  TX: 'Central', LA: 'Central', OK: 'Central', NM: 'Central', AR: 'Central',
  // standalone geographic buckets the portal splits out
  CO: 'Colorado', UT: 'Utah', IA: 'Iowa',
  // Northeast
  NY: 'Northeast', NJ: 'Northeast', CT: 'Northeast', MA: 'Northeast', ME: 'Northeast',
  NH: 'Northeast', VT: 'Northeast', RI: 'Northeast', PA: 'Northeast', MD: 'Northeast',
  DE: 'Northeast', WV: 'Northeast', VA: 'Northeast',
  // Southeast
  GA: 'Southeast', FL: 'Southeast', NC: 'Southeast', SC: 'Southeast', TN: 'Southeast',
  AL: 'Southeast', KY: 'Southeast', MS: 'Southeast',
  // Other (everything else, explicitly mapped so unknown codes fall through to ASK)
  AZ: 'Other', HI: 'Other', IN: 'Other', OH: 'Other', MI: 'Other', WI: 'Other', MN: 'Other',
  KS: 'Other', NE: 'Other', MO: 'Other', SD: 'Other', ND: 'Other', AK: 'Other', IL: 'Other', WY: 'Other',
};

const CANADA = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK', 'NT', 'YT', 'NU']);

// CA: NorCal = Bay Area & north (Salinas+); SoCal = LA & south. Central valley = ASK.
const CA_NORCAL = new Set(['san francisco', 'oakland', 'san jose', 'sacramento', 'salinas', 'santa rosa', 'berkeley', 'fremont', 'concord', 'modesto', 'stockton', 'walnut creek', 'milpitas', 'rocklin']);
const CA_SOCAL = new Set(['los angeles', 'san diego', 'irvine', 'anaheim', 'long beach', 'riverside', 'san bernardino', 'santa ana', 'pasadena', 'torrance', 'escondido', 'duarte']);
const CA_ASK = new Set(['fresno', 'bakersfield', 'visalia', 'merced', 'clovis']);

function abbr(state: string): string {
  const s = (state || '').trim();
  if (s.length === 2) return s.toUpperCase();
  return FULL_TO_ABBR[s.toLowerCase()] || s.toUpperCase();
}

export function detectRegion(state: string, city: string): string {
  const st = abbr(state);
  const c = (city || '').trim().toLowerCase();
  if (CANADA.has(st)) return 'Canada';
  if (st === 'CA') {
    if (CA_ASK.has(c)) return 'ASK';
    if (CA_SOCAL.has(c)) return 'SoCal';
    if (CA_NORCAL.has(c)) return 'NorCal';
    return 'ASK';
  }
  if (st === 'NV') {
    if (c.includes('reno') || c.includes('sparks') || c.includes('carson')) return 'NorCal';
    if (c.includes('vegas') || c.includes('henderson')) return 'SoCal';
    return 'ASK';
  }
  return STATE_TO_REGION[st] || 'ASK';
}
