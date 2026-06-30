// Per-DMS ClickUp description builders.
// Each builder produces the VERBATIM format defined in
// docs/reference/onboarding-skill/SKILL.md so the dev team's AI can parse it.

export interface DescInput {
  platform: 'Fortellis' | 'Reynolds' | 'DealerVault' | 'Tekion';
  name: string;
  brand: string;
  owner: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  /** The underlying DMS (e.g. DealerTrack, PBS for DealerVault; Reynolds for Reynolds; etc.) */
  dms: string;
  platform_fields: Record<string, unknown>;
}

/** Shared header block — first 7 fields, same in all formats. */
function header(input: DescInput): string {
  return [
    `Dealership Name: ${input.name}`,
    `Brand: ${input.brand}`,
    `Owner: ${input.owner}`,
    `Dealership Address: ${input.address}`,
    `City: ${input.city}`,
    `State: ${input.state}`,
    `Zip Code: ${input.zip}`,
  ].join('\n');
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function buildFortellis(input: DescInput): string {
  const { platform_fields: pf } = input;
  return [
    header(input),
    '',
    'API Platform: Fortellis',
    'Door Rate: $225',
    'DMS: CDK',
    '',
    `Fortellis Subscription ID: ${str(pf.subscription_id)}`,
    `Fortellis Department ID: ${str(pf.department_id)}`,
    '',
    'Fluids Provider: MOC Products',
  ].join('\n');
}

function buildReynolds(input: DescInput): string {
  const { platform_fields: pf } = input;
  return [
    header(input),
    '',
    'API Platform: Reynolds',
    'Door Rate: $225',
    'DMS: Reynolds',
    '',
    `Reynolds PPSYSID: ${str(pf.ppsysid)}`,
    `Reynolds Store Code: ${str(pf.store_code)}`,
    `Historical File Delivered: ${str(pf.historical_file_delivered)}`,
    '',
    'Fluids Provider: MOC Products',
  ].join('\n');
}

function buildDealerVault(input: DescInput): string {
  const { platform_fields: pf } = input;
  return [
    header(input),
    '',
    'API Platform: DealerVault',
    'Door Rate: $225',
    `DMS: ${input.dms}`,
    '',
    `DealerVault ID: ${str(pf.dealervault_id)}`,
    '',
    'Fluids Provider: MOC Products',
  ].join('\n');
}

function buildTekion(input: DescInput): string {
  const { platform_fields: pf } = input;
  return [
    header(input),
    '',
    'API Platform: Tekion',
    'Door Rate: $225',
    'DMS: Tekion',
    '',
    `Tekion Dealer ID: ${str(pf.tekion_dealer_id)}`,
    '',
    'Fluids Provider: MOC Products',
  ].join('\n');
}

/** Build the ClickUp task description for the given platform/input. */
export function buildDescription(input: DescInput): string {
  switch (input.platform) {
    case 'Fortellis':
      return buildFortellis(input);
    case 'Reynolds':
      return buildReynolds(input);
    case 'DealerVault':
      return buildDealerVault(input);
    case 'Tekion':
      return buildTekion(input);
    default: {
      // TypeScript exhaustive check
      const _never: never = input.platform;
      throw new Error(`Unknown platform: ${_never}`);
    }
  }
}
