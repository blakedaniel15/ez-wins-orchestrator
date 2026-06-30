// Self-test registry — runs pure-logic assertions server-side so we can verify
// correctness on Vercel (this project has no local Node/test runner). Each lib
// registers its cases via `cases(...)`; `/api/selftest` runs them all and
// returns pass/fail per case. Keep cases pure (no DB/network).

export interface Case {
  name: string;
  pass: boolean;
  expected?: unknown;
  actual?: unknown;
}

type Suite = () => Case[];
const SUITES: { suite: string; run: Suite }[] = [];

export function register(suite: string, run: Suite): void {
  SUITES.push({ suite, run });
}

// Helper to build a case from an equality check.
export function eq(name: string, expected: unknown, actual: unknown): Case {
  return { name, pass: JSON.stringify(expected) === JSON.stringify(actual), expected, actual };
}

export function runSelfTests(): { passed: number; failed: number; suites: { suite: string; cases: Case[] }[] } {
  const suites = SUITES.map(({ suite, run }) => {
    let cases: Case[];
    try {
      cases = run();
    } catch (e) {
      cases = [{ name: `${suite} threw`, pass: false, actual: (e as Error).message }];
    }
    return { suite, cases };
  });
  let passed = 0;
  let failed = 0;
  for (const s of suites) for (const c of s.cases) (c.pass ? passed++ : failed++);
  return { passed, failed, suites };
}
