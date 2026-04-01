/**
 * Fitness API routes — /api/workouts, /api/nutrition, /api/recovery, /api/progress
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../../src/types.js';

const fitness = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Workouts ───────────────────────────────────────────────────────────────

fitness.post('/workouts', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const id = crypto.randomUUID();

  await c.env.DB.prepare(`
    INSERT INTO fitness_workouts (id, user_id, date, type, exercises, duration_min, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, body.date, body.type,
    JSON.stringify(body.exercises || []),
    body.durationMin, body.notes || null,
  ).run();

  return c.json({ id, ...body }, 201);
});

fitness.get('/workouts', async (c) => {
  const userId = c.get('userId');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');

  const results = await c.env.DB.prepare(`
    SELECT * FROM fitness_workouts WHERE user_id = ? ORDER BY date DESC LIMIT ? OFFSET ?
  `).bind(userId, limit, offset).all();

  return c.json(results.results.map((r: any) => ({
    ...r,
    exercises: JSON.parse(r.exercises || '[]'),
  })));
});

fitness.get('/workouts/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(`
    SELECT * FROM fitness_workouts WHERE id = ? AND user_id = ?
  `).bind(id, userId).first();

  if (!result) return c.json({ error: 'Workout not found' }, 404);
  return c.json({ ...result, exercises: JSON.parse((result as any).exercises || '[]') });
});

fitness.delete('/workouts/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await c.env.DB.prepare(`DELETE FROM fitness_workouts WHERE id = ? AND user_id = ?`).bind(id, userId).run();
  return c.json({ ok: true });
});

// ─── Nutrition ──────────────────────────────────────────────────────────────

fitness.post('/nutrition', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const id = crypto.randomUUID();

  await c.env.DB.prepare(`
    INSERT INTO fitness_nutrition (id, user_id, date, meal, items, total_calories, total_protein_g, total_carbs_g, total_fat_g, water_ml, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, body.date, body.meal,
    JSON.stringify(body.items || []),
    body.totalCalories || 0, body.totalProteinG || 0, body.totalCarbsG || 0, body.totalFatG || 0,
    body.waterMl || 0, body.notes || null,
  ).run();

  return c.json({ id, ...body }, 201);
});

fitness.get('/nutrition', async (c) => {
  const userId = c.get('userId');
  const date = c.req.query('date');
  const limit = parseInt(c.req.query('limit') || '30');

  let query = 'SELECT * FROM fitness_nutrition WHERE user_id = ?';
  const params: any[] = [userId];

  if (date) { query += ' AND date = ?'; params.push(date); }
  query += ' ORDER BY date DESC LIMIT ?';
  params.push(limit);

  const results = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(results.results.map((r: any) => ({
    ...r,
    items: JSON.parse(r.items || '[]'),
  })));
});

fitness.get('/nutrition/summary', async (c) => {
  const userId = c.get('userId');
  const start = c.req.query('start');
  const end = c.req.query('end');
  if (!start || !end) return c.json({ error: 'Provide start and end dates' }, 400);

  const result = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(total_calories), 0) as total_calories,
      COALESCE(SUM(total_protein_g), 0) as total_protein_g,
      COALESCE(SUM(total_carbs_g), 0) as total_carbs_g,
      COALESCE(SUM(total_fat_g), 0) as total_fat_g,
      COUNT(DISTINCT date) as days_logged
    FROM fitness_nutrition
    WHERE user_id = ? AND date >= ? AND date <= ?
  `).bind(userId, start, end).first();

  return c.json(result);
});

// ─── Recovery ───────────────────────────────────────────────────────────────

fitness.post('/recovery', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const id = crypto.randomUUID();

  await c.env.DB.prepare(`
    INSERT INTO fitness_recovery (id, user_id, date, sleep_hours, sleep_quality, soreness, energy_level, mood, resting_hr, hrv, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, body.date, body.sleepHours, body.sleepQuality,
    body.soreness, body.energyLevel, body.mood,
    body.restingHr || null, body.hrv || null, body.notes || null,
  ).run();

  return c.json({ id, ...body }, 201);
});

fitness.get('/recovery', async (c) => {
  const userId = c.get('userId');
  const limit = parseInt(c.req.query('limit') || '14');

  const results = await c.env.DB.prepare(`
    SELECT * FROM fitness_recovery WHERE user_id = ? ORDER BY date DESC LIMIT ?
  `).bind(userId, limit).all();

  return c.json(results.results);
});

fitness.get('/recovery/score', async (c) => {
  const userId = c.get('userId');
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);

  const result = await c.env.DB.prepare(`
    SELECT * FROM fitness_recovery WHERE user_id = ? AND date = ?
  `).bind(userId, date).first();

  if (!result) return c.json({ date, score: 0, readiness: 'no_data' });

  const r = result as any;
  const sleepScore = r.sleep_hours >= 7 ? 30 : r.sleep_hours >= 6 ? 20 : 10;
  const score = Math.min(100, sleepScore + r.sleep_quality * 4 + r.energy_level * 6 + (6 - r.soreness) * 6 + r.mood * 6);
  const readiness = score >= 75 ? 'ready' : score >= 50 ? 'moderate' : 'rest';

  return c.json({ date, score, readiness });
});

// ─── Progress ───────────────────────────────────────────────────────────────

fitness.post('/progress', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();

  await c.env.DB.prepare(`
    INSERT INTO fitness_progress (user_id, date, weight_kg, body_fat_pct, measurements)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET weight_kg=excluded.weight_kg, body_fat_pct=excluded.body_fat_pct, measurements=excluded.measurements
  `).bind(
    userId, body.date, body.weightKg || null, body.bodyFatPct || null,
    JSON.stringify(body.measurements || {}),
  ).run();

  return c.json({ ok: true }, 201);
});

fitness.get('/progress', async (c) => {
  const userId = c.get('userId');
  const limit = parseInt(c.req.query('limit') || '30');

  const results = await c.env.DB.prepare(`
    SELECT * FROM fitness_progress WHERE user_id = ? ORDER BY date DESC LIMIT ?
  `).bind(userId, limit).all();

  return c.json(results.results.map((r: any) => ({
    ...r,
    measurements: JSON.parse(r.measurements || '{}'),
  })));
});

fitness.get('/progress/exercise/:name', async (c) => {
  const userId = c.get('userId');
  const name = decodeURIComponent(c.req.param('name'));
  const limit = parseInt(c.req.query('limit') || '20');

  const results = await c.env.DB.prepare(`
    SELECT date, exercises FROM fitness_workouts
    WHERE user_id = ? ORDER BY date DESC LIMIT ?
  `).bind(userId, limit * 2).all();

  const history: any[] = [];
  for (const row of results.results as any[]) {
    const exercises = JSON.parse(row.exercises || '[]');
    for (const ex of exercises) {
      if (ex.name.toLowerCase() === name.toLowerCase() && ex.sets?.length) {
        const maxWeight = Math.max(...ex.sets.map((s: any) => s.weightKg || 0));
        const volume = ex.sets.reduce((s: number, set: any) => s + (set.weightKg || 0) * set.reps, 0);
        history.push({ date: row.date, maxWeight, volume, sets: ex.sets });
        break;
      }
    }
    if (history.length >= limit) break;
  }

  return c.json(history.reverse());
});

export default fitness;
