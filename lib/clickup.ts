// ClickUp — write/read the `project_id` and `dealer_id` text custom fields on a
// task. Auth header is the RAW token (not "Bearer ..."), matching the email
// assistant. Custom fields are PER-SPACE in ClickUp (different UUID per space),
// so we resolve the field by NAME off the task itself (env var is a fallback).

const CLICKUP_BASE = 'https://api.clickup.com/api/v2';

function authHeader(): string {
  const t = process.env.CLICKUP_API_TOKEN;
  if (!t) throw new Error('CLICKUP_API_TOKEN is not set.');
  return t;
}

interface ClickUpTask {
  id: string;
  name: string;
  status?: { type?: string; status?: string };
  custom_fields?: { id: string; name?: string; value?: unknown }[];
}

export async function getTask(taskId: string): Promise<ClickUpTask | null> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}`, {
    headers: { Authorization: authHeader() },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ClickUp task fetch failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as ClickUpTask;
}

function fieldIdByName(task: ClickUpTask, name: string, envFallback?: string): string | undefined {
  return (task.custom_fields || []).find((c) => c.name === name)?.id || envFallback;
}

async function postFieldValue(taskId: string, fieldId: string, value: string): Promise<void> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}/field/${fieldId}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`ClickUp field write failed (${res.status}): ${await res.text()}`);
}

// Create a task on a list. task_type 'Branch' triggers ClickUp's auto-subtask
// automation (we only ever create the parent). Returns the new task id.
export async function createTask(
  listId: string,
  body: { name: string; description: string; task_type?: string; tags?: string[] }
): Promise<string> {
  const res = await fetch(`${CLICKUP_BASE}/list/${listId}/task`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ClickUp create task failed (${res.status}): ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

export async function setTaskStatus(taskId: string, status: string): Promise<void> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}`, {
    method: 'PUT',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`ClickUp status update failed (${res.status}): ${await res.text()}`);
}

export async function addComment(taskId: string, text: string): Promise<void> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}/comment`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment_text: text }),
  });
  if (!res.ok) throw new Error(`ClickUp comment failed (${res.status}): ${await res.text()}`);
}

// Set the plain-text "MOC Region" custom field (resolved by NAME — per-space UUIDs).
export async function writeMocRegionField(taskId: string, region: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found in ClickUp.`);
  const fid = fieldIdByName(task, 'MOC Region', process.env.CLICKUP_MOC_REGION_FIELD_UUID);
  if (!fid) throw new Error(`No 'MOC Region' custom field on task ${taskId}'s space — create the text field.`);
  await postFieldValue(taskId, fid, region);
}

export async function writeProjectIdField(taskId: string, projectId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found in ClickUp.`);
  const fid = fieldIdByName(task, 'project_id', process.env.CLICKUP_PROJECT_ID_FIELD_UUID);
  if (!fid) throw new Error(`No 'project_id' custom field on task ${taskId}'s space.`);
  await postFieldValue(taskId, fid, projectId);
}

export async function readProjectIdField(taskId: string): Promise<string | null> {
  const task = await getTask(taskId);
  if (!task) return null;
  const fid = fieldIdByName(task, 'project_id', process.env.CLICKUP_PROJECT_ID_FIELD_UUID);
  const f = (task.custom_fields || []).find((c) => c.id === fid);
  const v = f?.value;
  return v == null || v === '' ? null : String(v);
}

// Set the Dealer ID custom field on a task (the universal id, so every task rolls
// up to its dealership). Field resolved by name 'dealer_id' (env fallback).
export async function writeDealerIdField(taskId: string, dealerId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found in ClickUp.`);
  const fid = fieldIdByName(task, 'dealer_id', process.env.CLICKUP_DEALER_ID_FIELD_UUID);
  if (!fid) throw new Error(`No 'dealer_id' custom field on task ${taskId}'s space.`);
  await postFieldValue(taskId, fid, dealerId);
}
