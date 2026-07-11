/**
 * Phase 0 Smoke Test - to be run after `wrangler deploy`
 * Usage: npx tsx test/smoke/phase0-smoke.ts https://your-worker.workers.dev
 *
 * Per Collaboration Protocol §4 - smoke is user's manual responsibility minimal
 * This script POSTs a webhook and checks InternalEvent + TransportRequest rendering
 */

const url = process.argv[2] ?? 'http://localhost:8787/webhook/github-ci';

async function main() {
  console.log(`[smoke] POST ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Gateway-Source': 'github-ci' },
    body: JSON.stringify({
      event_type: 'build.failed',
      severity: 'high',
      title: 'Smoke test - build failed',
      body: { branch: 'main', commit: 'smoke123' },
      timestamp: new Date().toISOString()
    })
  });

  const text = await res.text();
  console.log(`[smoke] status=${res.status}`);
  console.log(text.slice(0, 2000));

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('Not JSON');
    process.exit(1);
  }

  if (res.status !== 200) {
    console.error('Expected 200');
    process.exit(1);
  }
  if (!json.event || !json.rendered) {
    console.error('Missing event/rendered - Phase 0 failed');
    process.exit(1);
  }

  console.log(`[smoke] OK - event_id=${json.event.event_id} trace=${json.trace} rendered=${json.rendered.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
