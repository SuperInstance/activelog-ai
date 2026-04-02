// activelog.ai — Activity/Fitness Tracker

export interface Env { ACTIVELOG_KV: KVNamespace }

import { loadBYOKConfig, callLLM, generateSetupHTML } from './lib/byok.js';

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*;";

const FEATURES = [
  { title: 'Workout Tracking', desc: 'Log workouts with sets, reps, duration, and intensity.' },
  { title: 'Activity Dashboard', desc: 'See your daily, weekly, and monthly activity at a glance.' },
  { title: 'AI Coaching', desc: 'Get personalized coaching and workout suggestions via BYOK.' },
  { title: 'Wearable Sync', desc: 'Connect to Wearable APIs for automatic activity import.' },
];

function landing(): string {
  const features = FEATURES.map(f => `<div class="card"><h3>${f.title}</h3><p>${f.desc}</p></div>`).join('\n');
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ActiveLog.ai — Move More, Know More</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui;background:#0a0a1a;color:#e0e0e0}
.hero{background:linear-gradient(135deg,#22c55e,#0a1628);padding:4rem 2rem;text-align:center}
.hero h1{font-size:3rem;background:linear-gradient(90deg,#86efac,#22c55e);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem}
.hero p{color:#8899bb;font-size:1.1rem;max-width:600px;margin:0 auto 2rem}
.cta{display:inline-block;background:#22c55e;color:#0a0a1a;padding:0.8rem 2rem;border-radius:8px;font-weight:bold;text-decoration:none;margin-top:1rem}
.cta:hover{transform:scale(1.05)}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1.5rem;max-width:900px;margin:3rem auto;padding:0 2rem}
.card{background:#111;border:1px solid #1e2a4a;border-radius:12px;padding:1.5rem}
.card h3{color:#22c55e;margin-bottom:.5rem}
.card p{color:#667;font-size:.9rem}
.footer{text-align:center;padding:2rem;color:#334;font-size:.8rem;border-top:1px solid #111}
</style></head><body>
<div class="hero">
  <h1>ActiveLog.ai</h1>
  <p>Move more, know more. Track workouts, activities, and health metrics with AI coaching.</p>
  <a href="/setup" class="cta">Get Started</a>
</div>
<div class="features">${features}</div>
<div class="footer">ActiveLog.ai — Built by Superinstance · Part of the Cocapn Ecosystem</div>
</body></html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const htmlHeaders = { 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': CSP };
    const jsonHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'activelog.ai' }, null, 2), { headers: jsonHeaders });
    }

    if (url.pathname === '/setup') {
      return new Response(generateSetupHTML('ActiveLog.ai', '#22c55e'), { headers: htmlHeaders });
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      const config = await loadBYOKConfig(request, { KV: env.ACTIVELOG_KV });
      if (!config) return new Response(JSON.stringify({ error: 'No BYOK config. Visit /setup' }), { status: 401, headers: jsonHeaders });
      const body = await request.json() as { messages: any[] };
      return callLLM(config, body.messages);
    }

    if (url.pathname === '/api/activities') {
      return new Response(JSON.stringify({ activities: [], total: 0 }), { headers: jsonHeaders });
    }

    if (url.pathname === '/api/workouts') {
      return new Response(JSON.stringify({ workouts: [], total: 0 }), { headers: jsonHeaders });
    }

    if (url.pathname === '/api/stats') {
      return new Response(JSON.stringify({ totalWorkouts: 0, totalMinutes: 0, streak: 0 }), { headers: jsonHeaders });
    }

    return new Response(landing(), { headers: htmlHeaders });
  },
};
