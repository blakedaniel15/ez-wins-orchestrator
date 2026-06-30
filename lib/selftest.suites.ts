// Registers self-test suites. As pure-logic libs land (regions, brands,
// descriptions, roster matrix, feed parsers), add their cases here by calling
// `register('<suite>', () => Case[])`. Keeping registrations in one file avoids
// circular imports and makes the coverage visible at a glance.

import { register, eq } from './selftest';

register('harness', () => [eq('1+1', 2, 1 + 1)]);
