import { createTask, setTaskStatus, writeProjectIdField, writeDealerIdField, writeMocRegionField } from '@/lib/clickup';
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
  // MOC Region only when resolved (skip 'ASK' — it waits in the review queue).
  // Best-effort: a missing 'MOC Region' field must not fail task creation.
  let warning: string | undefined;
  if (d.region && d.region !== 'ASK') {
    try {
      await writeMocRegionField(taskId, d.region);
    } catch (e) {
      warning = `MOC Region not set: ${(e as Error).message}`;
    }
  }
  return { taskId, warning };
}

export async function completeOnboardingTask(taskId: string): Promise<void> {
  await setTaskStatus(taskId, 'complete');
}
