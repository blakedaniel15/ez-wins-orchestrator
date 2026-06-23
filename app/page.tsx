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

  if (authed === null) {
    return <div style={S.wrap}>Loading…</div>;
  }

  if (!authed) {
    return (
      <div style={S.wrap}>
        <h1 style={S.h1}>EZ Wins Orchestrator</h1>
        <p style={S.sub}>Phase 0 — internal. Enter the admin password.</p>
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
            <button style={S.btn} onClick={login}>
              Sign in
            </button>
          </div>
          {loginErr && <p style={{ color: '#e5564b', fontSize: 13 }}>{loginErr}</p>}
        </div>
      </div>
    );
  }

  return <Dashboard onLogout={() => setAuthed(false)} />;
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  // create form
  const [type, setType] = useState('onboarding');
  const [dealerName, setDealerName] = useState('');
  const [dms, setDms] = useState('');
  const [conduit, setConduit] = useState('');
  const [createMsg, setCreateMsg] = useState('');
  const [dupe, setDupe] = useState<any[] | null>(null);
  const [projects, setProjects] = useState<any[]>([]);

  // acceptance runner
  const [projectId, setProjectId] = useState('');
  const [dealerId, setDealerId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [subjectQ, setSubjectQ] = useState('');
  const [threads, setThreads] = useState<any[]>([]);
  const [steps, setSteps] = useState<Record<string, StepState>>({
    portal: { status: 'idle' },
    clickup: { status: 'idle' },
    outlook: { status: 'idle' },
    lookup: { status: 'idle' },
  });

  function setStep(k: string, s: StepState) {
    setSteps((prev) => ({ ...prev, [k]: s }));
  }

  async function loadProjects() {
    const r = await fetch('/api/projects').then((x) => x.json());
    if (r.ok) setProjects(r.projects || []);
  }
  useEffect(() => {
    loadProjects();
  }, []);

  async function createProject(force = false) {
    setCreateMsg('Minting…');
    setDupe(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, dealer_name: dealerName || null, dms: dms || null, conduit: conduit || null, force }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (j.ok) {
        setCreateMsg(`✓ Minted ${j.project.id}`);
        setProjectId(j.project.id);
        setDealerName('');
        setDms('');
        setConduit('');
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
        setStep(kind, {
          status: j.match ? 'ok' : 'fail',
          msg: j.match ? `Read back: ${j.readback}` : `Mismatch — read back: ${j.readback ?? '(none)'}`,
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

  async function lookupByConversation() {
    setStep('lookup', { status: 'running' });
    const r = await fetch(`/api/projects?conversationId=${encodeURIComponent(conversationId)}`).then((x) => x.json());
    if (r.ok && r.project) {
      setStep('lookup', { status: 'ok', msg: `Found ${r.project.id} (${r.project.type})` });
    } else {
      setStep('lookup', { status: 'fail', msg: 'No project linked to that conversationId.' });
    }
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
          <p style={S.sub}>Phase 0 — project registry + cross-system wiring</p>
        </div>
        <button style={S.btnGhost} onClick={logout}>
          Sign out
        </button>
      </div>

      {/* ── Create ─────────────────────────────────────────── */}
      <div style={S.card}>
        <h2 style={S.h2}>1 · Create a project (mint an ID)</h2>
        <div style={S.row}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={S.label}>Type</label>
            <select style={S.input} value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label style={S.label}>Dealer name</label>
            <input style={S.input} value={dealerName} onChange={(e) => setDealerName(e.target.value)} placeholder="e.g. Don Ayres Honda" />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label style={S.label}>DMS</label>
            <input style={S.input} value={dms} onChange={(e) => setDms(e.target.value)} placeholder="CDK" />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label style={S.label}>Conduit</label>
            <input style={S.input} value={conduit} onChange={(e) => setConduit(e.target.value)} placeholder="fortellis" />
          </div>
          <button style={S.btn} onClick={() => createProject(false)}>
            Mint
          </button>
        </div>
        {createMsg && <p style={{ color: '#37c871', fontSize: 13, marginTop: 12 }}>{createMsg}</p>}
        {dupe && (
          <div style={{ marginTop: 12, padding: 12, border: '1px solid #5a4a1f', borderRadius: 8, background: '#241d09' }}>
            <p style={{ margin: '0 0 8px', color: '#e5c354', fontSize: 13 }}>
              A project for that dealer already exists:
            </p>
            {dupe.map((p) => (
              <div key={p.id} style={{ ...S.mono, fontSize: 13 }}>
                {p.id} — {p.type} {p.dms ? `· ${p.dms}` : ''}
              </div>
            ))}
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button style={S.btn} onClick={() => createProject(true)}>
                Create anyway
              </button>
              <button style={S.btnGhost} onClick={() => setDupe(null)}>
                Cancel
              </button>
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
                  <span style={{ color: '#7e8ca8' }}>{p.dealer_name || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Acceptance test ────────────────────────────────── */}
      <div style={S.card}>
        <h2 style={S.h2}>2 · Acceptance test — link the ID across systems</h2>
        <label style={S.label}>Project ID (mint above or paste one)</label>
        <input style={{ ...S.input, ...S.mono }} value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="ONB-2026-0001" />

        {/* portal */}
        <div style={{ marginTop: 18, ...S.row }}>
          <div style={{ flex: '1 1 240px' }}>
            <label style={S.label}>Portal dealer ID {dot(steps.portal.status)}</label>
            <input style={S.input} value={dealerId} onChange={(e) => setDealerId(e.target.value)} placeholder="existing dealer id" />
          </div>
          <button style={S.btn} onClick={() => runWire('portal', { projectId, dealerId })}>
            Write + read back
          </button>
        </div>
        {steps.portal.msg && <p style={{ fontSize: 12, color: '#9db2d3' }}>{steps.portal.msg}</p>}

        {/* clickup */}
        <div style={{ marginTop: 14, ...S.row }}>
          <div style={{ flex: '1 1 240px' }}>
            <label style={S.label}>ClickUp task ID {dot(steps.clickup.status)}</label>
            <input style={S.input} value={taskId} onChange={(e) => setTaskId(e.target.value)} placeholder="existing task id" />
          </div>
          <button style={S.btn} onClick={() => runWire('clickup', { projectId, taskId })}>
            Write + read back
          </button>
        </div>
        {steps.clickup.msg && <p style={{ fontSize: 12, color: '#9db2d3' }}>{steps.clickup.msg}</p>}

        {/* outlook */}
        <div style={{ marginTop: 14 }}>
          <label style={S.label}>Outlook thread {dot(steps.outlook.status)}</label>
          <div style={S.row}>
            <div style={{ flex: '1 1 240px' }}>
              <input style={S.input} value={subjectQ} onChange={(e) => setSubjectQ(e.target.value)} placeholder="search by subject…" />
            </div>
            <button style={S.btnGhost} onClick={searchThreads}>
              Find threads
            </button>
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
            <button style={S.btn} onClick={() => runWire('outlook', { projectId, conversationId })}>
              Tag thread + store
            </button>
          </div>
          {steps.outlook.msg && <p style={{ fontSize: 12, color: '#9db2d3' }}>{steps.outlook.msg}</p>}
        </div>

        {/* lookup */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #1f2c45' }}>
          <label style={S.label}>5 · Reverse lookup — find the project from a thread {dot(steps.lookup.status)}</label>
          <div style={S.row}>
            <div style={{ flex: '1 1 320px' }}>
              <input style={{ ...S.input, ...S.mono }} value={conversationId} onChange={(e) => setConversationId(e.target.value)} placeholder="conversationId" />
            </div>
            <button style={S.btnGhost} onClick={lookupByConversation}>
              Look up project
            </button>
          </div>
          {steps.lookup.msg && <p style={{ fontSize: 12, color: '#9db2d3' }}>{steps.lookup.msg}</p>}
        </div>
      </div>

      <p style={{ ...S.sub, textAlign: 'center' }}>
        Phase 0 links to existing dealers / tasks / threads — it does not create them.
      </p>
    </div>
  );
}
