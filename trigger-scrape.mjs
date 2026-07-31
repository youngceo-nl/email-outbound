// Trigger a following-list scrape for allday.fba via Inngest dev server
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mxngjwyfomahzswcgkwu.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14bmdqd3lmb21haHpzd2Nna3d1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAzOTI3MCwiZXhwIjoyMDkyNjE1MjcwfQ.c4P1DKY8rwPqSINbGod1oeYjxVAOKkoY6i06Av52ECQ';

const SEED_ID = '89a0cb6d-42fa-43a9-b786-9b3507ab7378';   // allday.fba
const SEED_USERNAME = 'allday.fba';
const PROFILE_LIMIT = 1000;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// 1. Create crawl job
const { data: job, error: jobErr } = await sb
  .from('crawl_jobs')
  .insert({ seed_id: SEED_ID, status: 'queued', max_depth: 1 })
  .select('id')
  .single();

if (jobErr || !job) {
  console.error('Failed to create crawl job:', jobErr?.message);
  process.exit(1);
}
console.log('Crawl job created:', job.id);

// 2. Send event to Inngest (dev server on :8288, or Next.js on :3000)
// Try the Inngest dev server first, fall back to the app's inngest route
const event = {
  name: 'crawl/seed.requested',
  data: {
    crawl_job_id: job.id,
    seed_id: SEED_ID,
    seed_username: SEED_USERNAME,
    profile_limit: PROFILE_LIMIT,
    provider_override: null,
  },
};

// Inngest dev server endpoint
const targets = [
  'http://localhost:8288/e/test',              // Inngest dev server
  'http://localhost:3000/api/inngest',         // App's Inngest route (for dev)
];

let sent = false;
for (const url of targets) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    const body = await res.text();
    if (res.ok || res.status === 200 || res.status === 201) {
      console.log(`Event sent via ${url} (${res.status}):`, body.slice(0, 200));
      sent = true;
      break;
    } else {
      console.log(`${url} → ${res.status}: ${body.slice(0, 100)}`);
    }
  } catch (e) {
    console.log(`${url} → unreachable: ${e.message}`);
  }
}

if (!sent) {
  // Update job to failed so it's visible in the dashboard
  await sb.from('crawl_jobs').update({ status: 'failed', error_message: 'Inngest not reachable' }).eq('id', job.id);
  console.error('Could not reach Inngest. Start the dev server with: npm run dev');
  process.exit(1);
}

// 3. Update job with inngest run id (best effort)
await sb.from('crawl_jobs').update({ status: 'running' }).eq('id', job.id);
console.log('\n✓ Scrape queued for allday.fba');
console.log('  Seed ID:', SEED_ID);
console.log('  Crawl job:', job.id);
console.log('  Profile limit:', PROFILE_LIMIT);
console.log('\nTrack progress in the dashboard → Logs tab');
