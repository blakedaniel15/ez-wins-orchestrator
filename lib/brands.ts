const ABBREV: [RegExp, string][] = [
  [/\bcdjr\b/i, 'Chrysler, Dodge, Jeep, Ram'],
  [/\bcjdr\b/i, 'Chrysler, Dodge, Jeep, Ram'],
  [/\bcdj\b/i, 'Chrysler, Dodge, Jeep'],
  [/\bvw\b/i, 'Volkswagen'],
];
const MARQUES = ['Chevrolet', 'Buick', 'GMC', 'Cadillac', 'Ford', 'Lincoln', 'Toyota', 'Honda', 'Nissan', 'Hyundai', 'Kia', 'Subaru', 'Mazda', 'Volkswagen', 'Audi', 'BMW', 'Mercedes-Benz', 'Lexus', 'Acura', 'Infiniti', 'Jeep', 'Dodge', 'Ram', 'Chrysler', 'Volvo', 'Porsche', 'Genesis', 'Mitsubishi'];

export function detectBrand(name: string): string | null {
  const n = name || '';
  for (const [re, exp] of ABBREV) if (re.test(n)) return exp;
  const found = MARQUES.filter((m) => new RegExp(`\\b${m.replace('-', '[- ]?')}\\b`, 'i').test(n));
  return found.length ? found.join(', ') : null;
}

export function titleCase(name: string): string {
  const s = name || '';
  // Only re-case if it's effectively all-caps; preserve mixed-case names.
  if (s !== s.toUpperCase()) return s;
  const small = new Set(['of', 'the', 'and', 'at', 'in', 'on', 'for']);
  return s.toLowerCase().split(/\s+/).map((w, i) =>
    small.has(w) && i > 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(' ');
}
