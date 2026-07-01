// DMS → conduit mapping. The conduit is how the feed reaches us; the dms is the
// underlying system (what the ID-needed rules key off). A DealerTrack/AutoMate/PBS
// store rides in via DealerVault; CDK via Fortellis; Reynolds via RCI; Tekion direct.

const DMS_CONDUIT: Record<string, string> = {
  cdk: 'fortellis',
  fortellis: 'fortellis',
  reynolds: 'reynolds_rci',
  'reynolds & reynolds': 'reynolds_rci',
  tekion: 'tekion',
  dealertrack: 'dealervault',
  automate: 'dealervault',
  'auto/mate': 'dealervault',
  pbs: 'dealervault',
  dealerbuilt: 'dealervault',
  autosoft: 'dealervault',
};

export function dmsToConduit(dms: string | null | undefined): string | null {
  if (!dms) return null;
  return DMS_CONDUIT[dms.trim().toLowerCase()] || 'direct';
}
