'use client';

import { useEffect, useState } from 'react';

// ── tiny style kit ────────────────────────────────────────────────────
const S = {
  wrap: { maxWidth: 920, margin: '0 auto', padding: '32px 20px 80px' } as const,
  card: {
    background: '#121b2e',
    border: '1px solid #1f2c45',
    borderRadius: 12,
    padding: 20,
    marginBottom: 18,
  } as const,
  h1: { fontSize: 22, fontWeight: 700, margin: '0 0 4px' } as const,
  h2: { fontSize: 15, fontWeight: 700, margin: '0 0 12px', color: '#9db2d3' } as const,
  sub: { color: '#7e8ca8', fontSize: 13, margin: '0 0 18px' } as const,
  label: { display: 'block', fontSize: 12, color: '#9db2d3', margin: '10px 0 4px' } as const,
  input: {
    width: '100%',
    padding: '9px 11px',
    background: '#0b1220',
    border: '1px solid #28354f',
    borderRadius: 8,
    color: '#e6edf6',
  } as const,
  btn: {
    padding: '9px 14px',
    background: '#2563eb',
    border: 'none',
    borderRadius: 8,
    color: 'white',
    fontWeight: 600,
    cursor: 'pointer',
  } as const,
  btnGhost: {
    padding: '7px 12px',
    background: 'transparent',
    border: '1px solid #28354f',
    borderRadius: 8,
    color: '#cdd9ee',
    cursor: 'pointer',
  } as const,
  row: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' } as const,
  pill: (bg: string) =>
    ({
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      background: bg,
    }) as const,
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } as const,
};

type Status = 'idle' | 'running' | 'ok' | 'fail';
interface StepState {
  status: Status;
  msg?: string;
}

const TYPES = [
  { v: 'onboarding', label: 'Onboarding (ONB)' },
  { v: 'support', label: 'Support (SUP)' },
  { v: 'warranty_uplift', label: 'Warranty uplift (WUP)' },
  { v: 'investigation', label: 'Investigation (INV)' },
];

function dot(s: Status) {
  const color = s === 'ok' ? '#37c871' : s === 'fail' ? '#e5564b' : s === 'running' ? '#d9a441' : '#3a4a66';
  return <span style={{ ...S.pill(color), color: '#06101e' }}>{s === 'idle' ? '•' : s.toUpperCase()}</span>;
}

export default function Page() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [loginErr, setLoginErr] = useState('');

  useEffect(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((j) => setAuthed(!!j.authed))
      .catch(() => setAuthed(false));
  }, []);

  async function login() {
    setLoginErr('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const j = await res.json();
    if (j.ok) {
      setAuthed(true);
      setPassword('');
    } else {
      setLoginErr(j.error || 'Login failed.');
    }
  }

  if (authed === null) return <div style={S.wrap}>Loading…</div>;

  if (!authed) {
    return (
      <div style={S.wrap}>
        <h1 style={S.h1}>EZ Wins Orchestrator</h1>
        <p style={S.sub}>Phase 0.5 — internal. Enter the admin password.</p>
        <div style={S.card}>
          <label style={S.label}>Admin password</label>
          <input
            style={S.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login()}
          />
          <div style={{ marginTop: 14 }}>
            <button style={S.btn} onClick={login}>Sign in</button>
          </div>
          {loginErr && <p style={{ color: '#e5564b', fontSize: 13 }}>{loginErr}</p>}
        </div>
      </div>
    );
  }

  return <Dashboard onLogout={() => setAuthed(false)} />;
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  // entities
  const [groups, setGroups] = useState<any[]>([]);
  const [dealerships, setDealerships] = useState<any[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupThreadId, setGroupThreadId] = useState('');
  const [groupConv, setGroupConv] = useState('');
  const [groupTagMsg, setGroupTagMsg] = useState('');
  const [dlrName, setDlrName] = useState('');
  const [dlrGroupId, setDlrGroupId] = useState('');
  const [dlrDms, setDlrDms] = useState('');
  const [dlrConduit, setDlrConduit] = useState('');
  const [dlrOems, setDlrOems] = useState('');
  const [dlrPortalId, setDlrPortalId] = useState('');
  const [dlrResult, setDlrResult] = useState('');
  const [history, setHistory] = useState<{ dealership: any; projects: any[] } | null>(null);
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [relinkPortal, setRelinkPortal] = useState('');
  const [relinkGroup, setRelinkGroup] = useState('');
  const [relinkMsg, setRelinkMsg] = useState('');

  // project create
  const [type, setType] = useState('onboarding');
  const [projDealershipId, setProjDealershipId] = useState('');
  const [createMsg, setCreateMsg] = useState('');
  const [dupe, setDupe] = useState<any[] | null>(null);
  const [projects, setProjects] = useState<any[]>([]);

  // acceptance wiring
  const [projectId, setProjectId] = useState('');
  const [dealerId, setDealerId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [subjectQ, setSubjectQ] = useState('');
  const [threads, setThreads] = useState<any[]>([]);
  const [chain, setChain] = useState<any | null>(null);
  const [steps, setSteps] = useState<Record<string, StepState>>({
    portal: { status: 'idle' },
    clickup: { status: 'idle' },
    outlook: { status: 'idle' },
  });

  function setStep(k: string, s: StepState) {
    setSteps((prev) => ({ ...prev, [k]: s }));
  }

  async function loadProjects() {
    const r = await fetch('/api/projects').then((x) => x.json());
    if (r.ok) setProjects(r.projects || []);
  }
  async function loadEntities() {
    const [g, d] = await Promise.all([
      fetch('/api/groups').then((x) => x.json()),
      fetch('/api/dealerships').then((x) => x.json()),
    ]);
    if (g.ok) setGroups(g.groups || []);
    if (d.ok) setDealerships(d.dealerships || []);
  }
  useEffect(() => {
    loadProjects();
    loadEntities();
  }, []);

  async function createGroupFn() {
    const r = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: groupName }),
    }).then((x) => x.json());
    if (r.ok) {
      setGroupName('');
      loadEntities();
    }
  }

  async function tagGroupThread() {
    setGroupTagMsg('Tagging…');
    try {
      const r = await fetch('/api/wire/group-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: groupThreadId, conversationId: groupConv }),
      }).then((x) => x.json());
      setGroupTagMsg(r.ok ? `✓ tagged ${r.tagged} message(s) with ${r.category}` : `✗ ${r.error}`);
    } catch (e: any) {
      setGroupTagMsg(`✗ ${e.message}`);
    }
  }

  async function createDealershipFn() {
    setDlrResult('Creating…');
    const oems = dlrOems.split(',').map((s) => s.trim()).filter(Boolean);
    const r = await fetch('/api/dealerships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: dlrName, group_id: dlrGroupId || null, dms: dlrDms || null,
        conduit: dlrConduit || null, oems, portal_dealer_id: dlrPortalId || null,
      }),
    }).then((x) => x.json());
    if (r.ok) {
      const p = r.portal
        ? `· portal dealer ${r.portal.action} (${r.portal.portalDealerId})`
        : r.portalError
          ? `· ⚠ portal: ${r.portalError}`
          : '';
      setDlrResult(`✓ ${r.dealership.id} ${p}`);
      setDlrName(''); setDlrDms(''); setDlrConduit(''); setDlrOems(''); setDlrPortalId('');
      setProjDealershipId(r.dealership.id);
      loadEntities();
    } else {
      setDlrResult(`✗ ${r.error || 'Failed.'}`);
    }
  }

  async function loadHistory(d: any) {
    setProjDealershipId(d.id);
    setRelinkPortal(d.portal_dealer_id || '');
    setRelinkGroup(d.group_id || '');
    setRelinkMsg('');
    const r = await fetch(`/api/projects?dealershipId=${encodeURIComponent(d.id)}`).then((x) => x.json());
    setHistory({ dealership: d, projects: r.ok ? r.projects || [] : [] });
  }

  async function patchDealership(body: any, okMsg: (r: any) => string) {
    setRelinkMsg('Saving…');
    try {
      const r = await fetch('/api/dealerships', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: history?.dealership.id, ...body }),
      }).then((x) => x.json());
      if (r.ok) {
        setRelinkMsg(okMsg(r));
        if (r.dealership) loadHistory(r.dealership);
        loadEntities();
      } else setRelinkMsg(`✗ ${r.error}`);
    } catch (e: any) {
      setRelinkMsg(`✗ ${e.message}`);
    }
  }

  async function runImport() {
    setImporting(true);
    setImportMsg('Importing from portal… (this can take a bit)');
    try {
      const r = await fetch('/api/import/portal', { method: 'POST' }).then((x) => x.json());
      if (r.ok) {
        const s = r.summary;
        setImportMsg(
          `✓ ${s.dealershipsCreated} created, ${s.dealershipsRegrouped} re-grouped (${s.dealershipsSkipped} existing), ` +
          `${s.groupsCreated} new groups, ${s.portalDealersStamped} stamped — of ${s.totalPortalDealers} total.`
        );
        loadEntities();
      } else {
        setImportMsg(`✗ ${r.error || 'Import failed.'}`);
      }
    } catch (e: any) {
      setImportMsg(`✗ ${e.message || 'Request failed.'}`);
    }
    setImporting(false);
  }

  async function createProject(force = false) {
    setCreateMsg('Minting…');
    setDupe(null);
    if (!projDealershipId) {
      setCreateMsg('✗ Pick a dealership first.');
      return;
    }
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, dealership_id: projDealershipId, force }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (j.ok) {
        setCreateMsg(`✓ Minted ${j.project.id}`);
        setProjectId(j.project.id);
        loadProjects();
      } else if (j.duplicate) {
        setCreateMsg('');
        setDupe(j.duplicate);
      } else {
        setCreateMsg(`✗ ${j.error || 'Failed.'}`);
      }
    } catch (e: any) {
      setCreateMsg(`✗ ${e.message || 'Request failed.'}`);
    }
  }

  async function runWire(kind: 'portal' | 'clickup' | 'outlook', payload: any) {
    setStep(kind, { status: 'running' });
    try {
      const res = await fetch(`/api/wire/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!j.ok) {
        setStep(kind, { status: 'fail', msg: j.error });
        return;
      }
      if (kind === 'outlook') {
        setStep(kind, { status: 'ok', msg: `Tagged ${j.tagged} message(s) with ${j.category}` });
      } else {
        const dealerNote =
          kind === 'clickup'
            ? j.dealerStamp ? ` · dealer ${j.dealerStamp}` : j.dealerError ? ` · dealer: ${j.dealerError}` : ''
            : '';
        setStep(kind, {
          status: j.match ? 'ok' : 'fail',
          msg: (j.match ? `Read back: ${j.readback}` : `Mismatch — read back: ${j.readback ?? '(none)'}`) + dealerNote,
        });
      }
    } catch (e: any) {
      setStep(kind, { status: 'fail', msg: e.message });
    }
  }

  async function searchThreads() {
    setThreads([]);
    const r = await fetch(`/api/wire/outlook?search=${encodeURIComponent(subjectQ)}`).then((x) => x.json());
    if (r.ok) setThreads(r.threads || []);
    else setStep('outlook', { status: 'fail', msg: r.error });
  }

  async function resolveChain() {
    const r = await fetch(`/api/resolve?conversationId=${encodeURIComponent(conversationId)}`).then((x) => x.json());
    setChain(r.ok ? r : { kind: 'error', error: r.error });
  }

  async function logout() {
    await fetch('/api/login', { method: 'DELETE' });
    onLogout();
  }

  return (
    <div style={S.wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={S.h1}>EZ Wins Orchestrator</h1>
          <p style={S.sub}>Phase 0.5 — group → dealership → project</p>
        </div>
        <button style={S.btnGhost} onClick={logout}>Sign out</button>
      </div>

      {/* ── Bulk import ────────────────────────────────────── */}
      <div style={S.card}>
        <h2 style={S.h2}>Import dealers from the portal</h2>
        <p style={{ ...S.sub, margin: '0 0 12px' }}>
          One-click, idempotent. Creates a dealership + group record for every portal dealer/group,
          links them, and stamps the Dealer ID back onto each portal dealer. Safe to re-run.
        </p>
        <button style={S.btn} onClick={runImport} disabled={importing}>
          {importing ? 'Importing…' : 'Import from portal'}
        </button>
        {importMsg && <p style={{ color: importMsg.startsWith('✗') ? '#e5564b' : '#37c871', fontSize: 13, marginTop: 12 }}>{importMsg}</p>}
      </div>

      {/* ── A · Groups ─────────────────────────────────────── */}
      <div style={S.card}>
        <h2 style={S.h2}>A · Dealer groups</h2>
        <div style={S.row}>
          <div style={{ flex: '1 1 260px' }}>
            <label style={S.label}>Group name</label>
            <input style={S.input} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. Phil Long" />
          </div>
          <button style={S.btn} onClick={createGroupFn}>Create group</button>
        </div>
        {groups.length > 0 && (
          <div style={{ marginTop: 12, ...S.mono, fontSize: 13, lineHeight: 1.7, maxHeight: 200, overflowY: 'auto' }}>
            {groups.map((g) => (
              <div key={g.id} style={{ cursor: 'pointer' }} onClick={() => { setDlrGroupId(g.id); setGroupThreadId(g.id); }}>
                <span style={{ color: '#6ea8fe' }}>{g.id}</span> {g.name}
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #1f2c45' }}>
          <label style={S.label}>Tag a thread to a group (one thread → all its dealers)</label>
          <div style={S.row}>
            <div style={{ flex: '1 1 150px' }}>
              <input style={{ ...S.input, ...S.mono }} value={groupThreadId} onChange={(e) => setGroupThreadId(e.target.value)} placeholder="GRP-000007 (click a group)" />
            </div>
            <div style={{ flex: '1 1 280px' }}>
              <input style={{ ...S.input, ...S.mono }} value={groupConv} onChange={(e) => setGroupConv(e.target.value)} placeholder="conversationId" />
            </div>
            <button style={S.btn} onClick={tagGroupThread}>Tag thread → group</button>
          </div>
          {groupTagMsg && <p style={{ fontSize: 12, color: groupTagMsg.startsWith('✗') ? '#e5564b' : '#37c871' }}>{groupTagMsg}</p>}
        </div>
      </div>

      {/* ── B · Dealerships ────────────────────────────────── */}
      <div style={S.card}>
        <h2 style={S.h2}>B · Dealerships (the first-class unit)</h2>
        <div style={S.row}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={S.label}>Name</label>
            <input style={S.input} value={dlrName} onChange={(e) => setDlrName(e.target.value)} placeholder="Phil Long Hyundai of Chapel Hills" />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={S.label}>Group ID (optional)</label>
            <input style={{ ...S.input, ...S.mono }} value={dlrGroupId} onChange={(e) => setDlrGroupId(e.target.value)} placeholder="GRP-000007" />
          </div>
          <div style={{ flex: '1 1 110px' }}>
            <label style={S.label}>DMS</label>
            <input style={S.input} value={dlrDms} onChange={(e) => setDlrDms(e.target.value)} placeholder="CDK" />
          </div>
          <div style={{ flex: '1 1 110px' }}>
            <label style={S.label}>Conduit</label>
            <input style={S.input} value={dlrConduit} onChange={(e) => setDlrConduit(e.target.value)} placeholder="fortellis" />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={S.label}>OEMs (comma-sep)</label>
            <input style={S.input} value={dlrOems} onChange={(e) => setDlrOems(e.target.value)} placeholder="Hyundai" />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={S.label}>Portal dealer ID (blank = auto)</label>
            <input style={{ ...S.input, ...S.mono }} value={dlrPortalId} onChange={(e) => setDlrPortalId(e.target.value)} placeholder="blank → orchestrator creates/links" />
          </div>
          <button style={S.btn} onClick={createDealershipFn}>Create dealership</button>
        </div>
        {dlrResult && <p style={{ color: dlrResult.startsWith('✗') ? '#e5564b' : '#37c871', fontSize: 13, marginTop: 12 }}>{dlrResult}</p>}
        {dealerships.length > 0 && (
          <div style={{ marginTop: 12, ...S.mono, fontSize: 13, lineHeight: 1.7 }}>
            {dealerships.slice(0, 10).map((d) => (
              <div key={d.id} style={{ cursor: 'pointer' }} onClick={() => loadHistory(d)}>
                <span style={{ color: '#37c871' }}>{d.id}</span> {d.name}
                <span style={{ color: '#7e8ca8' }}> {Array.isArray(d.oems) ? d.oems.join('/') : ''} {d.group_id ? `· ${d.group_id}` : ''} {d.portal_dealer_id ? `· portal ${d.portal_dealer_id}` : ''}</span>
              </div>
            ))}
          </div>
        )}
        {history && (
          <div style={{ marginTop: 16, padding: 12, border: '1px solid #28354f', borderRadius: 8, background: '#0b1220' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#cdd9ee' }}>
              {history.dealership.id} — {history.dealership.name}
            </div>
            <div style={{ ...S.mono, fontSize: 12, color: '#7e8ca8', marginTop: 4 }}>
              {history.dealership.dms || '—'} · {Array.isArray(history.dealership.oems) ? history.dealership.oems.join('/') : ''} ·
              portal {history.dealership.portal_dealer_id || '(none)'} · group {history.dealership.group_id || '(none)'}
            </div>
            <div style={{ ...S.mono, fontSize: 12, marginTop: 10 }}>
              {history.projects.length === 0
                ? <span style={{ color: '#7e8ca8' }}>No projects yet.</span>
                : history.projects.map((p) => (
                    <div key={p.id} style={{ padding: '2px 0' }}>
                      <span style={{ color: '#6ea8fe' }}>{p.id}</span>{' '}
                      <span style={{ color: '#9db2d3' }}>{p.type} · {p.status}</span>
                      {p.clickup_task_id ? <span style={{ color: '#7e8ca8' }}> · task {p.clickup_task_id}</span> : null}
                    </div>
                  ))}
            </div>
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #1f2c45' }}>
              <label style={S.label}>Relink / repair</label>
              <div style={S.row}>
                <div style={{ flex: '1 1 200px' }}>
                  <input style={{ ...S.input, ...S.mono }} value={relinkPortal} onChange={(e) => setRelinkPortal(e.target.value)} placeholder="portal dealer id" />
                </div>
                <div style={{ flex: '1 1 140px' }}>
                  <input style={{ ...S.input, ...S.mono }} value={relinkGroup} onChange={(e) => setRelinkGroup(e.target.value)} placeholder="group id" />
                </div>
                <button style={S.btn} onClick={() => patchDealership({ portal_dealer_id: relinkPortal || undefined, group_id: relinkGroup || undefined }, () => '✓ saved')}>Save links</button>
                <button style={S.btnGhost} onClick={() => patchDealership({ connectPortal: true }, (r) => `✓ portal ${r.portal?.action} (${r.portal?.portalDealerId})`)}>Auto-connect portal</button>
              </div>
              {relinkMsg && <p style={{ fontSize: 12, color: relinkMsg.startsWith('✗') ? '#e5564b' : '#37c871' }}>{relinkMsg}</p>}
            </div>
          </div>
        )}
      </div>

      {/* ── 1 · Create a project ───────────────────────────── */}
      <div style={S.card}>
        <h2 style={S.h2}>1 · Create a project (engagement)</h2>
        <div style={S.row}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={S.label}>Type</label>
            <select style={S.input} value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <label style={S.label}>Dealership ID (pick from list B)</label>
            <input style={{ ...S.input, ...S.mono }} value={projDealershipId} onChange={(e) => setProjDealershipId(e.target.value)} placeholder="DLR-000142" />
          </div>
          <button style={S.btn} onClick={() => createProject(false)}>Mint project</button>
        </div>
        {createMsg && <p style={{ color: createMsg.startsWith('✗') ? '#e5564b' : '#37c871', fontSize: 13, marginTop: 12 }}>{createMsg}</p>}
        {dupe && (
          <div style={{ marginTop: 12, padding: 12, border: '1px solid #5a4a1f', borderRadius: 8, background: '#241d09' }}>
            <p style={{ margin: '0 0 8px', color: '#e5c354', fontSize: 13 }}>An engagement of this type already exists for that dealership:</p>
            {dupe.map((p) => (
              <div key={p.id} style={{ ...S.mono, fontSize: 13 }}>{p.id} — {p.type}</div>
            ))}
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button style={S.btn} onClick={() => createProject(true)}>Create anyway</button>
              <button style={S.btnGhost} onClick={() => setDupe(null)}>Cancel</button>
            </div>
          </div>
        )}
        {projects.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <label style={S.label}>Recent projects</label>
            <div style={{ ...S.mono, fontSize: 13, lineHeight: 1.7 }}>
              {projects.slice(0, 8).map((p) => (
                <div key={p.id} style={{ display: 'flex', gap: 8, cursor: 'pointer' }} onClick={() => setProjectId(p.id)}>
                  <span style={{ color: '#6ea8fe' }}>{p.id}</span>
                  <span style={{ color: '#7e8ca8' }}>{p.dealership_id || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 2 · Acceptance test ────────────────────────────── */}
      <div style={S.card}>
        <h2 style={S.h2}>2 · Acceptance test — link the ID across systems</h2>
        <label style={S.label}>Project ID (mint above or paste one)</label>
        <input style={{ ...S.input, ...S.mono }} value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="ONB-2026-0001" />

        <div style={{ marginTop: 18, ...S.row }}>
          <div style={{ flex: '1 1 240px' }}>
            <label style={S.label}>Portal dealer ID {dot(steps.portal.status)}</label>
            <input style={S.input} value={dealerId} onChange={(e) => setDealerId(e.target.value)} placeholder="existing dealer id" />
          </div>
          <button style={S.btn} onClick={() => runWire('portal', { projectId, dealerId })}>Write + read back</button>
        </div>
        {steps.portal.msg && <p style={{ fontSize: 12, color: '#9db2d3' }}>{steps.portal.msg}</p>}

        <div style={{ marginTop: 14, ...S.row }}>
          <div style={{ flex: '1 1 240px' }}>
            <label style={S.label}>ClickUp task ID {dot(steps.clickup.status)}</label>
            <input style={S.input} value={taskId} onChange={(e) => setTaskId(e.target.value)} placeholder="existing task id" />
          </div>
          <button style={S.btn} onClick={() => runWire('clickup', { projectId, taskId })}>Write + read back</button>
        </div>
        {steps.clickup.msg && <p style={{ fontSize: 12, color: '#9db2d3' }}>{steps.clickup.msg}</p>}

        <div style={{ marginTop: 14 }}>
          <label style={S.label}>Outlook thread {dot(steps.outlook.status)}</label>
          <div style={S.row}>
            <div style={{ flex: '1 1 240px' }}>
              <input style={S.input} value={subjectQ} onChange={(e) => setSubjectQ(e.target.value)} placeholder="search by subject…" />
            </div>
            <button style={S.btnGhost} onClick={searchThreads}>Find threads</button>
          </div>
          {threads.length > 0 && (
            <div style={{ marginTop: 8, ...S.mono, fontSize: 12 }}>
              {threads.map((t) => (
                <div
                  key={t.conversationId}
                  style={{ padding: '4px 0', cursor: 'pointer', color: conversationId === t.conversationId ? '#37c871' : '#cdd9ee' }}
                  onClick={() => setConversationId(t.conversationId)}
                >
                  ▸ {t.subject || '(no subject)'} — <span style={{ color: '#7e8ca8' }}>{t.from}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8, ...S.row }}>
            <div style={{ flex: '1 1 320px' }}>
              <input style={{ ...S.input, ...S.mono }} value={conversationId} onChange={(e) => setConversationId(e.target.value)} placeholder="conversationId (or click a thread above)" />
            </div>
            <button style={S.btn} onClick={() => runWire('outlook', { projectId, conversationId })}>Tag thread + store</button>
          </div>
          {steps.outlook.msg && <p style={{ fontSize: 12, color: '#9db2d3' }}>{steps.outlook.msg}</p>}
        </div>

        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #1f2c45' }}>
          <label style={S.label}>5 · Resolve the chain — thread → group / dealership / projects</label>
          <div style={S.row}>
            <div style={{ flex: '1 1 320px' }}>
              <input style={{ ...S.input, ...S.mono }} value={conversationId} onChange={(e) => setConversationId(e.target.value)} placeholder="conversationId" />
            </div>
            <button style={S.btnGhost} onClick={resolveChain}>Resolve chain</button>
          </div>
          {chain && (
            <div style={{ fontSize: 12, color: '#9db2d3', marginTop: 6, ...S.mono }}>
              {chain.kind === 'group' && <div>Group {chain.group.id} ({chain.group.name}) → {chain.dealerships.length} dealership(s), {chain.projectCount} project(s)</div>}
              {chain.kind === 'project' && <div>Project {chain.project.id} → dealership {chain.dealership?.id} ({chain.dealership?.name})</div>}
              {chain.kind === 'none' && <div>No entity linked to that conversationId.</div>}
              {chain.kind === 'error' && <div style={{ color: '#e5564b' }}>✗ {chain.error}</div>}
            </div>
          )}
        </div>
      </div>

      <p style={{ ...S.sub, textAlign: 'center' }}>
        Phase 0.5 — group → dealership → project. Links to existing dealers / tasks / threads; doesn't create them.
      </p>
    </div>
  );
}
