import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const mutations = [
  ['WhatsApp expiry bypass', 'src/policy/guard.ts', 'if (age >= 24 * 3600000)', 'if (false)'],
  ['Deprecated tags accepted', 'src/policy/guard.ts', 'if (tag && ["CONFIRMED_EVENT_UPDATE", "POST_PURCHASE_UPDATE", "ACCOUNT_UPDATE"].includes(tag))', 'if (false)'],
  ['Promotion tag bypass', 'src/policy/guard.ts', 'if (tag && intent.promotional !== false)', 'if (false)'],
  ['Automated HUMAN_AGENT', 'src/policy/guard.ts', '!intent.human_agent || age >= 168 * 3600000', 'age >= 168 * 3600000'],
  ['Expired HUMAN_AGENT', 'src/policy/guard.ts', '!intent.human_agent || age >= 168 * 3600000', '!intent.human_agent'],
  ['Outside-wedge channels blocked', 'src/policy/guard.ts', 'if (OUTSIDE_META_WEDGE.has(evidence.channel))', 'if (false)'],
  ['Verified ad window disabled', 'src/policy/guard.ts', 'if (ad?.verified === true && matchesChannel', 'if (false && matchesChannel'],
  ['Invalid future time accepted', 'src/policy/guard.ts', '!Number.isFinite(last) || last > now', '!Number.isFinite(last)'],
  ['Blanket denial (positive controls)', 'src/policy/guard.ts', 'const tag = intent.message_tag;', 'return result(false, "MUTANT", "deny all"); const tag = intent.message_tag;'],
  ['Engine omits enforcement', 'src/core/engine.ts', 'if (!verdict.allowed) throw new PolicyError(verdict);', 'if (false) throw new PolicyError(verdict);'],
  ['CLI skips execution boundary', 'src/cli/app.ts', 'await engine.execute(name, input)', '{ unsafe: true }'],
];
const results = [];
for (const [name, file, from, to] of mutations) {
  const original = readFileSync(file, 'utf8');
  if (!original.includes(from)) throw new Error(`Mutation target missing: ${name}`);
  try {
    writeFileSync(file, original.replace(from, to));
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', 'tests/policy.test.ts', 'tests/engine.test.ts'], { encoding: 'utf8', timeout: 60000 });
    const output = (run.stdout ?? '') + (run.stderr ?? '');
    // A compilation/import failure is NOT evidence that a behavioral mutation died.
    const killed = run.status !== 0 && /Tests\s+\d+ failed/.test(output) && !/Failed Suites/.test(output);
    results.push({ name, killed });
    console.log(`${killed ? 'KILLED' : 'SURVIVED/INVALID'} ${name}`);
    if (!killed) console.error(output);
  } finally { writeFileSync(file, original); }
}
const killed = results.filter(r => r.killed).length;
console.log(`Behavioral mutations killed: ${killed}/${results.length}`);
if (killed !== results.length) process.exitCode = 1;
