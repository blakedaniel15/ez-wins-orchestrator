// Registers self-test suites. As pure-logic libs land (regions, brands,
// descriptions, roster matrix, feed parsers), add their cases here by calling
// `register('<suite>', () => Case[])`. Keeping registrations in one file avoids
// circular imports and makes the coverage visible at a glance.

import { register, eq } from './selftest';
import { detectRegion } from './regions';
import { detectBrand, titleCase } from './brands';

register('harness', () => [eq('1+1', 2, 1 + 1)]);

register('regions', () => [
  eq('OR→PNW', 'MOC PNW', detectRegion('OR', 'Portland')),
  eq('TX→Central', 'MOC Central', detectRegion('TX', 'Houston')),
  eq('NC→Mid-Atlantic', 'MOC Mid-Atlantic', detectRegion('NC', 'Charlotte')),
  eq('CA SF→NorCal', 'MOC NorCal', detectRegion('CA', 'San Francisco')),
  eq('CA LA→SoCal', 'MOC SoCal', detectRegion('CA', 'Los Angeles')),
  eq('NV Reno→NorCal', 'MOC NorCal', detectRegion('NV', 'Reno')),
  eq('NV Vegas→SoCal', 'MOC SoCal', detectRegion('NV', 'Las Vegas')),
  eq('CA Fresno→ASK', 'ASK', detectRegion('CA', 'Fresno')),
  eq('GA→Other', 'Other Distributors', detectRegion('GA', 'Atlanta')),
  eq('UT→Other', 'Other Distributors', detectRegion('UT', 'Logan')),
  eq('unmapped→ASK', 'ASK', detectRegion('ZZ', 'Nowhere')),
  eq('full state name', 'Other Distributors', detectRegion('Utah', 'Logan')),
]);

register('brands', () => [
  eq('CDJR', 'Chrysler, Dodge, Jeep, Ram', detectBrand('Concord CDJR')),
  eq('VW', 'Volkswagen', detectBrand('Dublin VW')),
  eq('multi', 'Buick, GMC', detectBrand('DeMontrond Buick GMC')),
  eq('none→null', null, detectBrand('Sunrise Auto Group')),
  eq('titlecase allcaps', 'Moon Township Honda', titleCase('MOON TOWNSHIP HONDA')),
  eq('titlecase mixed kept', 'Toyota of Modesto', titleCase('Toyota of Modesto')),
]);
