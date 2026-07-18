/**
 * ActiveLog.Ai — Cloudflare Worker API
 * 
 * Endpoints:
 *   POST /api/sessions          — Create session + annotations
 *   GET  /api/sessions          — List sessions
 *   GET  /api/sessions/:id      — Get session detail
 *   GET  /api/search?q=         — Semantic search (Vectorize)
 *   POST /api/embed             — Embed text ( Workers AI )
 *   GET  /api/health            — Health check
 */

export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AUDIO_BUCKET: R2Bucket;
  AI: Ai;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    try {
      // ── Health ────────────────────────────────────
      if (path === '/api/health') {
        return json({ ok: true, time: new Date().toISOString() });
      }

      // ── Create Session ────────────────────────────
      if (path === '/api/sessions' && request.method === 'POST') {
        const body = await request.json() as any;

        // Insert session
        await env.DB.prepare(`
          INSERT INTO sessions (id, user_id, title, started_at, ended_at,
            duration_seconds, annotation_count, word_count, tags, raw_markdown, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          body.id,
          body.user_id || 'default',
          body.title || `Session ${body.started_at.split('T')[0]}`,
          body.started_at,
          body.ended_at,
          body.duration_seconds || null,
          body.annotation_count || 0,
          body.word_count || 0,
          JSON.stringify(body.tags || []),
          body.raw_markdown,
        ).run();

        // Insert annotations
        if (body.annotations && Array.isArray(body.annotations)) {
          const stmts = body.annotations.map((ann: any) =>
            env.DB.prepare(`
              INSERT INTO annotations (id, session_id, timestamp, latitude, longitude,
                speed, heading, depth, water_temp, text_before, text_after, tags, important)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              `${body.id}-${ann.timestamp}`,
              body.id,
              ann.timestamp,
              ann.latitude || null,
              ann.longitude || null,
              ann.speed || null,
              ann.heading || null,
              ann.depth || null,
              ann.water_temp || null,
              ann.text_before || null,
              ann.text_after || null,
              JSON.stringify(ann.tags || []),
              ann.important ? 1 : 0,
            )
          );
          await env.DB.batch(stmts);
        }

        // Vectorize: embed annotation text segments
        if (body.annotations && env.VECTORIZE) {
          for (const ann of body.annotations) {
            if (!ann.text_before && !ann.text_after) continue;

            const text = `${ann.text_before || ''} ${ann.text_after || ''}`.trim();
            if (!text) continue;

            // Generate embedding
            const embedding = await env.AI.run(
              '@cf/baai/bge-small-en-v1.5',
              { text: text.slice(0, 512) }
            ) as any;

            if (embedding.data && embedding.data[0]) {
              await env.VECTORIZE.insert([{
                id: `${body.id}-${ann.timestamp}`,
                values: embedding.data[0],
                metadata: {
                  session_id: body.id,
                  timestamp: ann.timestamp,
                  latitude: ann.latitude?.toString() || '',
                  longitude: ann.longitude?.toString() || '',
                  tags: JSON.stringify(ann.tags || []),
                },
              }]);
            }
          }
        }

        return json({ ok: true, id: body.id, annotations: body.annotations?.length || 0 });
      }

      // ── List Sessions ─────────────────────────────
      if (path === '/api/sessions' && request.method === 'GET') {
        const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
        const offset = parseInt(url.searchParams.get('offset') || '0');

        const results = await env.DB.prepare(`
          SELECT id, title, started_at, ended_at, duration_seconds,
                 annotation_count, word_count, tags, synced_at
          FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?
        `).bind(limit, offset).all();

        return json({ sessions: results.results });
      }

      // ── Get Session ───────────────────────────────
      const sessionMatch = path.match(/^\/api\/sessions\/(.+)$/);
      if (sessionMatch && request.method === 'GET') {
        const id = sessionMatch[1];

        const session = await env.DB.prepare(`
          SELECT * FROM sessions WHERE id = ?
        `).bind(id).first();

        if (!session) {
          return json({ error: 'Session not found' }, 404);
        }

        const annotations = await env.DB.prepare(`
          SELECT * FROM annotations WHERE session_id = ? ORDER BY timestamp ASC
        `).bind(id).all();

        return json({ session, annotations: annotations.results });
      }

      // ── Semantic Search ───────────────────────────
      if (path === '/api/search' && request.method === 'GET') {
        const query = url.searchParams.get('q');
        if (!query) {
          return json({ error: 'Query required' }, 400);
        }

        if (!env.VECTORIZE) {
          // Fallback to text search
          const results = await env.DB.prepare(`
            SELECT id, title, started_at, annotation_count,
                   substr(raw_markdown, 1, 200) as preview
            FROM sessions
            WHERE raw_markdown LIKE ?
            ORDER BY started_at DESC LIMIT 20
          `).bind(`%${query}%`).all();
          return json({ results: results.results, mode: 'text' });
        }

        // Generate query embedding
        const embedding = await env.AI.run(
          '@cf/baai/bge-small-en-v1.5',
          { text: query }
        ) as any;

        if (!embedding.data || !embedding.data[0]) {
          return json({ error: 'Embedding failed' }, 500);
        }

        // Search Vectorize
        const vectorResults = await env.VECTORIZE.query(embedding.data[0], {
          topK: 20,
          returnMetadata: true,
        });

        // Enrich with session info
        const enriched = await Promise.all(
          (vectorResults.matches || []).map(async (match: any) => {
            const sessionId = match.metadata?.session_id;
            const session = await env.DB.prepare(
              `SELECT title, started_at FROM sessions WHERE id = ?`
            ).bind(sessionId).first();
            return {
              score: match.score,
              session_id: sessionId,
              timestamp: match.metadata?.timestamp,
              latitude: match.metadata?.latitude,
              longitude: match.metadata?.longitude,
              session_title: session?.title,
              session_date: session?.started_at,
            };
          })
        );

        return json({ results: enriched, mode: 'semantic' });
      }

      // ── Embed (utility) ───────────────────────────
      if (path === '/api/embed' && request.method === 'POST') {
        const { text } = await request.json() as any;
        if (!text) return json({ error: 'Text required' }, 400);

        const embedding = await env.AI.run(
          '@cf/baai/bge-small-en-v1.5',
          { text: text.slice(0, 512) }
        ) as any;

        return json({ embedding: embedding.data?.[0] || [] });
      }

      // ── 404 ───────────────────────────────────────
      return json({ error: 'Not found', path }, 404);

    } catch (err: any) {
      return json({ error: err.message, stack: err.stack }, 500);
    }
  },
};

// ── Helpers ──────────────────────────────────────────────
function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
