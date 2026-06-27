// ClickUp — write/read the `project_id` text custom field on an existing task.
// Auth header is the RAW token (not "Bearer ..."), matching ez-wins-email-assistant.

const CLICKUP_BASE = 'https://api.clickup.com/api/v2';

function authHeader(): string {
  const t = process.env.CLICKUP_API_TOKEN;
  if (!t) throw new Error('CLICKUP_API_TOKEN is not set.');
  return t;
}

function projectIdFieldUuid(): string {
  const id = process.env.CLICKUP_PROJECT_ID_FIELD_UUID;
  if (!id) throw new Error('CLICKUP_PROJECT_ID_FIELD_UUID is not set.');
  return id;
}

function dealerIdFieldUuid(): string {
  const id = process.env.CLICKUP_DEALER_ID_FIELD_UUID;
  if (!id) throw new Error('CLICKUP_DEALER_ID_FIELD_UUID is not set.');
  return id;
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

// Set the project_id custom field on a task (POST /task/{id}/field/{fieldId}).
export async function writeProjectIdField(taskId: string, projectId: string): Promise<void> {
  const url = `${CLICKUP_BASE}/task/${taskId}/field/${projectIdFieldUuid()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: projectId }),
  });
  if (!res.ok) throw new Error(`ClickUp field write failed (${res.status}): ${await res.text()}`);
}

// Read the project_id custom field value back off a task.
export async function readProjectIdField(taskId: string): Promise<string | null> {
  const task = await getTask(taskId);
  if (!task) return null;
  const fieldId = projectIdFieldUuid();
  const f = (task.custom_fields || []).find((c) => c.id === fieldId);
  const v = f?.value;
  return v == null || v === '' ? null : String(v);
}

// Set the Dealer ID custom field on a task (the universal id, so every task
// rolls up to its dealership). Requires CLICKUP_DEALER_ID_FIELD_UUID.
export async function writeDealerIdField(taskId: string, dealerId: string): Promise<void> {
  const url = `${CLICKUP_BASE}/task/${taskId}/field/${dealerIdFieldUuid()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: dealerId }),
  });
  if (!res.ok) throw new Error(`ClickUp dealer-id write failed (${res.status}): ${await res.text()}`);
}
