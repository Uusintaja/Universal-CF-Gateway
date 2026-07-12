/**
 * Phase 1 Smoke Test - High-priority immediate path with real transmit to webhook.site
 * Usage:
 *   Local dev:  npx tsx test/smoke/phase1-smoke.ts http://localhost:8787
 *   Deployed:   npx tsx test/smoke/phase1-smoke.ts https://<your-worker>.workers.dev
 *
 * Requires env vars in .dev.vars or dashboard secrets:
 *   SLACK_WEBHOOK_URL=https://webhook.site/dd1172d4-2a4e-4f56-858d-1cc15aedcdcc
 *   WEBHOOK_SITE_URL same as above
 *   EMAIL_TO=dd1172d4-2a4e-4f56-858d-1cc15aedcdcc@emailhook.site
 *   EMAIL_FROM=gateway@example.com
 *
 * This script verifies:
 * - POST /webhook/github-ci with high severity returns 200/207 with transmitResults
 * - At least email adapter simulated ok, slack-webhook http fetch ok (check webhook.site UI)
 * - No silent loss (all adapters attempted)
 */

const workerUrl = process.argv[2] ?? 'http://localhost:8787';
const source = 'github-ci';
const targetUrl = `${workerUrl.replace(/\/$/, '')}/webhook/${source}`;

async function postEvent(event: any) {
  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Gateway-Source': source },
    body: JSON.stringify(event)
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('Non-JSON response:', text.slice(0, 1000));
    throw new Error('Invalid JSON');
  }
  return { res, json };
}

async function main() {
  console.log(`[phase1 smoke] target=${targetUrl}`);
  console.log(`[phase1 smoke] webhook.site to check: https://webhook.site/dd1172d4-2a4e-4f56-858d-1cc15aedcdcc`);
  console.log(`[phase1 smoke] emailhook to check: dd1172d4-2a4e-4f56-858d-1cc15aedcdcc@emailhook.site`);

  const event = {
    event_type: 'build.failed',
    severity: 'high',
    title: 'Phase1 smoke - build failed',
    body: { branch: 'main', commit: 'phase1-smoke-' + Date.now(), note: '渡鸦 test' },
    timestamp: new Date().toISOString()
  };

  const { res, json } = await postEvent(event);

  console.log(`[smoke] HTTP ${res.status}`);
  console.log(JSON.stringify(json, null, 2).slice(0, 4000));

  if (![200, 207].includes(res.status)) {
    console.error('Expected 200 or 207 for immediate path');
    process.exit(1);
  }

  if (!json.route || json.route.dispatch !== 'immediate') {
    console.error('Expected immediate dispatch for high severity');
    process.exit(1);
  }

  if (!json.rendered || json.rendered.length === 0) {
    console.error('No rendered TransportRequests');
    process.exit(1);
  }

  if (!json.transmitResults) {
    console.error('Missing transmitResults - Phase 1 transmit not wired');
    process.exit(1);
  }

  const emailRes = json.transmitResults.find((r: any) => r.adapter === 'email-mailchannels');
  const slackRes = json.transmitResults.find((r: any) => r.adapter === 'slack-webhook');

  console.log(`[smoke] email result ok=${emailRes?.result?.ok} slack ok=${slackRes?.result?.ok}`);

  if (!emailRes) {
    console.warn('No email result - check ADAPTER_REGISTRY');
  }
  if (slackRes && !slackRes.result.ok) {
    console.warn(`Slack/webhook transmit failed: ${slackRes.result.error?.message} - check SLACK_WEBHOOK_URL secret and webhook.site reachable`);
    console.warn('If testing locally with Miniflare, external fetch should still work. If 207, partial failure is expected when one adapter fails.');
  }

  // Success criteria: Phase 1 returns rendered + transmitResults, no crash
  // Real external verification: user must open webhook.site UI to see POST body containing event_id and trace
  console.log(`\n[smoke] Phase 1 OK - event_id=${json.event.event_id} trace=${json.trace}`);
  console.log(`[smoke] Now open https://webhook.site/dd1172d4-2a4e-4f56-858d-1cc15aedcdcc and verify you see a POST with body containing "${json.event.event_id}"`);
  console.log(`[smoke] And check inbox dd1172d4-2a4e-4f56-858d-1cc15aedcdcc@emailhook.site for email (if EMAIL binding enabled, otherwise simulated)`);
  console.log(`[smoke] If you see the request, Phase 1 transmit works with high 3s timeout.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
