// Registers self-test suites. As pure-logic libs land (regions, brands,
// descriptions, roster matrix, feed parsers), add their cases here by calling
// `register('<suite>', () => Case[])`. Keeping registrations in one file avoids
// circular imports and makes the coverage visible at a glance.

import { register, eq } from './selftest';
import { detectRegion } from './regions';
import { detectBrand, titleCase } from './brands';
import { buildDescription } from './descriptions';
import { classifyKind, parseContactLines } from './contacts';
import { nextDue, addBusinessDays, addCalendarDaysRolled } from './cadence';

register('harness', () => [eq('1+1', 2, 1 + 1)]);

register('regions', () => [
  eq('OR→PNW', 'PNW', detectRegion('OR', 'Portland')),
  eq('TX→Central', 'Central', detectRegion('TX', 'Houston')),
  eq('NC→Southeast', 'Southeast', detectRegion('NC', 'Charlotte')),
  eq('NY→Northeast', 'Northeast', detectRegion('NY', 'Albany')),
  eq('CO→Colorado', 'Colorado', detectRegion('CO', 'Denver')),
  eq('IA→Iowa', 'Iowa', detectRegion('IA', 'Des Moines')),
  eq('CA SF→NorCal', 'NorCal', detectRegion('CA', 'San Francisco')),
  eq('CA LA→SoCal', 'SoCal', detectRegion('CA', 'Los Angeles')),
  eq('NV Reno→NorCal', 'NorCal', detectRegion('NV', 'Reno')),
  eq('NV Vegas→SoCal', 'SoCal', detectRegion('NV', 'Las Vegas')),
  eq('CA Fresno→ASK', 'ASK', detectRegion('CA', 'Fresno')),
  eq('GA→Southeast', 'Southeast', detectRegion('GA', 'Atlanta')),
  eq('UT→Utah', 'Utah', detectRegion('UT', 'Logan')),
  eq('AZ→Other', 'Other', detectRegion('AZ', 'Phoenix')),
  eq('unmapped→ASK', 'ASK', detectRegion('ZZ', 'Nowhere')),
  eq('full state name', 'Utah', detectRegion('Utah', 'Logan')),
]);

register('brands', () => [
  eq('CDJR', 'Chrysler, Dodge, Jeep, Ram', detectBrand('Concord CDJR')),
  eq('VW', 'Volkswagen', detectBrand('Dublin VW')),
  eq('multi', 'Buick, GMC', detectBrand('DeMontrond Buick GMC')),
  eq('none→null', null, detectBrand('Sunrise Auto Group')),
  eq('titlecase allcaps', 'Moon Township Honda', titleCase('MOON TOWNSHIP HONDA')),
  eq('titlecase mixed kept', 'Toyota of Modesto', titleCase('Toyota of Modesto')),
]);

register('descriptions', () => {
  const rey = buildDescription({
    platform: 'Reynolds',
    name: 'Scarborough Toyota',
    brand: 'Toyota',
    owner: 'Scarborough Toyota',
    address: '1 Main St',
    city: 'Scarborough',
    state: 'ME',
    zip: '04074',
    dms: 'Reynolds',
    platform_fields: { ppsysid: '713042', store_code: '0431', historical_file_delivered: '' },
  });
  const dv = buildDescription({
    platform: 'DealerVault',
    name: 'Citrus Motors Ford KIA',
    brand: 'Ford, Kia',
    owner: 'Citrus Motors Ford KIA',
    address: '1 A St',
    city: 'Covina',
    state: 'CA',
    zip: '91722',
    dms: 'DealerTrack',
    platform_fields: { dealervault_id: 'DVD39749' },
  });
  const fort = buildDescription({
    platform: 'Fortellis',
    name: 'Demo Ford',
    brand: 'Ford',
    owner: 'Demo Auto Group',
    address: '100 Demo Ave',
    city: 'Dallas',
    state: 'TX',
    zip: '75201',
    dms: 'CDK',
    platform_fields: { subscription_id: 'SUB-001', department_id: 'DEPT-002' },
  });
  const tek = buildDescription({
    platform: 'Tekion',
    name: 'Young Automotive',
    brand: 'Toyota',
    owner: 'Young Automotive Group',
    address: '500 Young Way',
    city: 'Layton',
    state: 'UT',
    zip: '84041',
    dms: 'Tekion',
    platform_fields: { tekion_dealer_id: 'youngautomotivegrouput_6837_0' },
  });
  return [
    // Reynolds
    eq('reynolds platform', true, rey.includes('API Platform: Reynolds')),
    eq('reynolds dms', true, rey.includes('DMS: Reynolds')),
    eq('reynolds ppsysid', true, rey.includes('Reynolds PPSYSID: 713042')),
    eq('reynolds store code', true, rey.includes('Reynolds Store Code: 0431')),
    eq('reynolds historical file', true, rey.includes('Historical File Delivered: ')),
    eq('reynolds door rate', true, rey.includes('Door Rate: $225')),
    eq('reynolds fluids', true, rey.includes('Fluids Provider: MOC Products')),
    eq('reynolds name', true, rey.includes('Dealership Name: Scarborough Toyota')),
    // DealerVault
    eq('dv platform', true, dv.includes('API Platform: DealerVault')),
    eq('dv underlying dms', true, dv.includes('DMS: DealerTrack')),
    eq('dv id', true, dv.includes('DealerVault ID: DVD39749')),
    eq('dv door rate', true, dv.includes('Door Rate: $225')),
    eq('dv fluids', true, dv.includes('Fluids Provider: MOC Products')),
    // Fortellis
    eq('fort platform', true, fort.includes('API Platform: Fortellis')),
    eq('fort dms', true, fort.includes('DMS: CDK')),
    eq('fort sub id', true, fort.includes('Fortellis Subscription ID: SUB-001')),
    eq('fort dept id', true, fort.includes('Fortellis Department ID: DEPT-002')),
    eq('fort fluids', true, fort.includes('Fluids Provider: MOC Products')),
    // Tekion
    eq('tekion platform', true, tek.includes('API Platform: Tekion')),
    eq('tekion dms', true, tek.includes('DMS: Tekion')),
    eq('tekion dealer id', true, tek.includes('Tekion Dealer ID: youngautomotivegrouput_6837_0')),
    eq('tekion fluids', true, tek.includes('Fluids Provider: MOC Products')),
  ];
});

register('contacts', () => {
  const parsed = parseContactLines('Jane Rep <jane@mocproducts.com>\nbob@dealer.com');
  return [
    eq('ez-wins→moc', 'moc', classifyKind('blake@ez-wins.com')),
    eq('mocproducts→moc', 'moc', classifyKind('jane@mocproducts.com')),
    eq('dealer domain→dealer', 'dealer', classifyKind('bob@somedealer.com')),
    eq('parse count', 2, parsed.length),
    eq('parse name', 'Jane Rep', parsed[0].name),
    eq('parse email', 'jane@mocproducts.com', parsed[0].email),
    eq('parse bare email', 'bob@dealer.com', parsed[1].email),
  ];
});

register('cadence', () => {
  const fri = new Date('2026-01-02T12:00:00.000Z'); // a Friday
  const mon = new Date('2026-01-05T12:00:00.000Z'); // a Monday
  return [
    eq('fri +2bd → Tue', '2026-01-06T12:00:00.000Z', nextDue(fri, 1).toISOString()),
    eq('mon +2bd → Wed', '2026-01-07T12:00:00.000Z', nextDue(mon, 1).toISOString()),
    eq('addBusinessDays skips weekend', '2026-01-06T12:00:00.000Z', addBusinessDays(fri, 2).toISOString()),
    eq('mon +5cal rolled off weekend → Mon', '2026-01-12T12:00:00.000Z', addCalendarDaysRolled(mon, 5).toISOString()),
  ];
});
