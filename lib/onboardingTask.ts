import { createTask, setTaskStatus, writeProjectIdField, writeDealerIdField, writeFieldsByName } from '@/lib/clickup';
import { buildDescription, type DescInput } from '@/lib/descriptions';
import { titleCase } from '@/lib/brands';
import type { Dealership } from '@/lib/dealerships';

// Map the dealership's conduit to the description platform. Conduit (not dms) is
// the right key: a DealerTrack store riding via DealerVault gets the DealerVault
// format, with its underlying dms shown in the DMS: line.
const PLATFORM_BY_CONDUIT: Record<string, DescInput['platform']> = {
  fortellis: 'Fortellis',
  reynolds_rci: 'Reynolds',
  dealervault: 'DealerVault',
  tekion: 'Tekion',
};

export async function createOnboardingTask(input: {
  dealership: Dealership;
  projectId: string;
  listId: string;
  ownerGroupName?: string | null;
  requestedBy?: string | null;
}): Promise<{ taskId: string; warning?: string }> {
  const d = input.dealership;
  const platform = PLATFORM_BY_CONDUIT[d.conduit || ''] || 'Fortellis';
  const name = titleCase(d.name);
  const description = buildDescription({
    platform,
    name,
    brand: d.brand || '',
    owner: input.ownerGroupName || name,
    address: d.address || '',
    city: d.city || '',
    state: d.state || '',
    zip: d.zip || '',
    dms: d.dms || '',
    platform_fields: d.platform_fields || {},
  });
  const taskId = await createTask(input.listId, { name, description, task_type: 'Branch' });
  // Stamp the universal IDs.
  await writeDealerIdField(taskId, d.id);
  await writeProjectIdField(taskId, input.projectId);
  // Set the human-facing fields in one pass. Best-effort — a missing field on the
  // space must not fail task creation; report any that couldn't be set.
  let warning: string | undefined;
  try {
    const fields: { name: string; value: string; env?: string }[] = [
      { name: 'Department', value: 'Onboarding' },
      { name: 'Approval Stage', value: 'Pending' },
    ];
    if (d.region && d.region !== 'ASK') fields.push({ name: 'MOC Region', value: d.region, env: process.env.CLICKUP_MOC_REGION_FIELD_UUID });
    if (input.requestedBy) fields.push({ name: 'Requested By', value: input.requestedBy });
    const { missing } = await writeFieldsByName(taskId, fields);
    if (missing.length) warning = `fields not set (no matching custom field): ${missing.join(', ')}`;
  } catch (e) {
    warning = (e as Error).message;
  }
  return { taskId, warning };
}

export async function completeOnboardingTask(taskId: string): Promise<void> {
  await setTaskStatus(taskId, 'complete');
}
