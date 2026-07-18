/**
 * ActiveLog.ai — Fitness tracking engine.
 * WorkoutLog, NutritionLog, RecoveryTracker, ProgressiveOverload, StreakTracker.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkoutEntry {
  id: string;
  userId: string;
  date: string;
  type: 'strength' | 'cardio' | 'flexibility' | 'hiit' | 'sports';
  exercises: ExerciseEntry[];
  durationMin: number;
  notes?: string;
  createdAt: string;
}

export interface ExerciseEntry {
  name: string;
  sets?: { reps: number; weightKg?: number; rpe?: number }[];
  distanceKm?: number;
  durationMin?: number;
  calories?: number;
}

export interface NutritionEntry {
  id: string;
  userId: string;
  date: string;
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  items: FoodItem[];
  totalCalories: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  waterMl?: number;
  notes?: string;
  createdAt: string;
}

export interface FoodItem {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize?: string;
}

export interface RecoveryEntry {
  id: string;
  userId: string;
  date: string;
  sleepHours: number;
  sleepQuality: 1 | 2 | 3 | 4 | 5;
  soreness: 1 | 2 | 3 | 4 | 5;
  energyLevel: 1 | 2 | 3 | 4 | 5;
  mood: 1 | 2 | 3 | 4 | 5;
  restingHr?: number;
  hrv?: number;
  notes?: string;
  createdAt: string;
}

export interface ProgressSnapshot {
  date: string;
  weightKg?: number;
  bodyFatPct?: number;
  measurements?: Record<string, number>;
}

// ─── WorkoutLog ─────────────────────────────────────────────────────────────

export class WorkoutLog {
  private entries: WorkoutEntry[] = [];

  add(entry: WorkoutEntry): void {
    this.entries.push(entry);
  }

  getByDate(date: string): WorkoutEntry[] {
    return this.entries.filter(e => e.date === date);
  }

  getByDateRange(start: string, end: string): WorkoutEntry[] {
    return this.entries.filter(e => e.date >= start && e.date <= end);
  }

  getByType(type: WorkoutEntry['type']): WorkoutEntry[] {
    return this.entries.filter(e => e.type === type);
  }

  getTotalDuration(start: string, end: string): number {
    return this.getByDateRange(start, end).reduce((sum, e) => sum + e.durationMin, 0);
  }

  getExerciseHistory(exerciseName: string): Array<{ date: string; sets: ExerciseEntry['sets'] }> {
    const results: Array<{ date: string; sets: ExerciseEntry['sets'] }> = [];
    for (const entry of this.entries) {
      for (const ex of entry.exercises) {
        if (ex.name.toLowerCase() === exerciseName.toLowerCase()) {
          results.push({ date: entry.date, sets: ex.sets });
        }
      }
    }
    return results;
  }

  getWeeklyVolume(): { week: string; totalSets: number; totalKg: number }[] {
    const weeks = new Map<string, { totalSets: number; totalKg: number }>();
    for (const entry of this.entries) {
      const weekStart = getWeekStart(entry.date);
      const existing = weeks.get(weekStart) || { totalSets: 0, totalKg: 0 };
      for (const ex of entry.exercises) {
        if (ex.sets) {
          for (const set of ex.sets) {
            existing.totalSets++;
            existing.totalKg += (set.weightKg || 0) * set.reps;
          }
        }
      }
      weeks.set(weekStart, existing);
    }
    return Array.from(weeks.entries())
      .map(([week, data]) => ({ week, ...data }))
      .sort((a, b) => a.week.localeCompare(b.week));
  }
}

// ─── NutritionLog ───────────────────────────────────────────────────────────

export class NutritionLog {
  private entries: NutritionEntry[] = [];

  add(entry: NutritionEntry): void {
    this.entries.push(entry);
  }

  getByDate(date: string): NutritionEntry[] {
    return this.entries.filter(e => e.date === date);
  }

  getDailySummary(date: string): { calories: number; protein: number; carbs: number; fat: number; water: number } {
    return this.getByDate(date).reduce(
      (acc, e) => ({
        calories: acc.calories + e.totalCalories,
        protein: acc.protein + e.totalProteinG,
        carbs: acc.carbs + e.totalCarbsG,
        fat: acc.fat + e.totalFatG,
        water: acc.water + (e.waterMl || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, water: 0 },
    );
  }

  getWeeklyAverage(start: string, end: string): { avgCalories: number; avgProtein: number; avgCarbs: number; avgFat: number } {
    const days = this.getUniqueDays(start, end);
    if (days.length === 0) return { avgCalories: 0, avgProtein: 0, avgCarbs: 0, avgFat: 0 };
    const totals = days.reduce(
      (acc, day) => {
        const summary = this.getDailySummary(day);
        return {
          calories: acc.calories + summary.calories,
          protein: acc.protein + summary.protein,
          carbs: acc.carbs + summary.carbs,
          fat: acc.fat + summary.fat,
        };
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );
    return {
      avgCalories: Math.round(totals.calories / days.length),
      avgProtein: Math.round(totals.protein / days.length),
      avgCarbs: Math.round(totals.carbs / days.length),
      avgFat: Math.round(totals.fat / days.length),
    };
  }

  getMacrosRatio(start: string, end: string): { proteinPct: number; carbsPct: number; fatPct: number } {
    const avg = this.getWeeklyAverage(start, end);
    const totalG = avg.avgProtein + avg.avgCarbs + avg.avgFat;
    if (totalG === 0) return { proteinPct: 0, carbsPct: 0, fatPct: 0 };
    return {
      proteinPct: Math.round((avg.avgProtein * 4 / (avg.avgCalories || 1)) * 100),
      carbsPct: Math.round((avg.avgCarbs * 4 / (avg.avgCalories || 1)) * 100),
      fatPct: Math.round((avg.avgFat * 9 / (avg.avgCalories || 1)) * 100),
    };
  }

  private getUniqueDays(start: string, end: string): string[] {
    const days = new Set<string>();
    for (const e of this.entries) {
      if (e.date >= start && e.date <= end) days.add(e.date);
    }
    return Array.from(days);
  }
}

// ─── RecoveryTracker ────────────────────────────────────────────────────────

export class RecoveryTracker {
  private entries: RecoveryEntry[] = [];

  add(entry: RecoveryEntry): void {
    this.entries.push(entry);
  }

  getByDate(date: string): RecoveryEntry | undefined {
    return this.entries.find(e => e.date === date);
  }

  getRecoveryScore(date: string): number {
    const entry = this.getByDate(date);
    if (!entry) return 0;
    const sleepScore = (entry.sleepHours >= 7 ? 30 : entry.sleepHours >= 6 ? 20 : 10);
    const qualityScore = entry.sleepQuality * 4;
    const energyScore = entry.energyLevel * 6;
    const sorenessScore = (6 - entry.soreness) * 6;
    const moodScore = entry.mood * 6;
    return Math.min(100, sleepScore + qualityScore + energyScore + sorenessScore + moodScore);
  }

  getWeeklyAvg(start: string, end: string): { sleep: number; energy: number; soreness: number; recovery: number } {
    const range = this.entries.filter(e => e.date >= start && e.date <= end);
    if (range.length === 0) return { sleep: 0, energy: 0, soreness: 0, recovery: 0 };
    const avg = range.reduce(
      (acc, e) => ({
        sleep: acc.sleep + e.sleepHours,
        energy: acc.energy + e.energyLevel,
        soreness: acc.soreness + e.soreness,
        recovery: acc.recovery + this.getRecoveryScore(e.date),
      }),
      { sleep: 0, energy: 0, soreness: 0, recovery: 0 },
    );
    const n = range.length;
    return {
      sleep: +(avg.sleep / n).toFixed(1),
      energy: +(avg.energy / n).toFixed(1),
      soreness: +(avg.soreness / n).toFixed(1),
      recovery: Math.round(avg.recovery / n),
    };
  }

  getReadiness(date: string): 'ready' | 'moderate' | 'rest' {
    const score = this.getRecoveryScore(date);
    if (score >= 75) return 'ready';
    if (score >= 50) return 'moderate';
    return 'rest';
  }

  getTrend(days: number = 7): 'improving' | 'stable' | 'declining' {
    if (this.entries.length < 3) return 'stable';
    const recent = this.entries.slice(-days);
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));
    const avgFirst = firstHalf.reduce((s, e) => s + this.getRecoveryScore(e.date), 0) / (firstHalf.length || 1);
    const avgSecond = secondHalf.reduce((s, e) => s + this.getRecoveryScore(e.date), 0) / (secondHalf.length || 1);
    const diff = avgSecond - avgFirst;
    if (diff > 5) return 'improving';
    if (diff < -5) return 'declining';
    return 'stable';
  }
}

// ─── ProgressiveOverload ────────────────────────────────────────────────────

export class ProgressiveOverload {
  private workoutLog: WorkoutLog;

  constructor(workoutLog: WorkoutLog) {
    this.workoutLog = workoutLog;
  }

  getSuggestion(exerciseName: string): { increaseWeight: boolean; increaseReps: boolean; newWeight?: number; newReps?: number; reason: string } {
    const history = this.workoutLog.getExerciseHistory(exerciseName);
    if (history.length < 2) {
      return { increaseWeight: false, increaseReps: false, reason: 'Need at least 2 sessions to suggest progression' };
    }

    const recent = history[history.length - 1];
    const previous = history[history.length - 2];

    if (!recent.sets?.length || !previous.sets?.length) {
      return { increaseWeight: false, increaseReps: false, reason: 'No set data available' };
    }

    const recentMaxWeight = Math.max(...recent.sets.map(s => s.weightKg || 0));
    const previousMaxWeight = Math.max(...previous.sets.map(s => s.weightKg || 0));
    const recentAvgReps = recent.sets.reduce((s, set) => s + set.reps, 0) / recent.sets.length;
    const previousAvgReps = previous.sets.reduce((s, set) => s + set.reps, 0) / previous.sets.length;

    if (recentMaxWeight > previousMaxWeight) {
      return { increaseWeight: true, increaseReps: false, newWeight: recentMaxWeight + 2.5, reason: 'Weight increased last session — maintain and add 2.5kg' };
    }
    if (recentAvgReps > previousAvgReps && recentAvgReps >= 8) {
      return { increaseWeight: true, increaseReps: false, newWeight: recentMaxWeight + 2.5, reason: 'Reps increased and >= 8 — ready to increase weight by 2.5kg' };
    }
    return { increaseWeight: false, increaseReps: true, newReps: Math.ceil(recentAvgReps) + 1, reason: 'Add 1 rep per set before increasing weight' };
  }

  getWeeklyProgress(exerciseName: string): { date: string; maxWeight: number; totalVolume: number }[] {
    return this.workoutLog.getExerciseHistory(exerciseName).map(h => ({
      date: h.date,
      maxWeight: Math.max(...(h.sets?.map(s => s.weightKg || 0) || [0])),
      totalVolume: h.sets?.reduce((sum, s) => sum + (s.weightKg || 0) * s.reps, 0) || 0,
    }));
  }
}

// ─── StreakTracker ──────────────────────────────────────────────────────────

export class StreakTracker {
  private workoutLog: WorkoutLog;

  constructor(workoutLog: WorkoutLog) {
    this.workoutLog = workoutLog;
  }

  getCurrentStreak(): { days: number; startDate: string | null } {
    const dates = [...new Set(this.workoutLog.getByDateRange('2000-01-01', '2099-12-31').map(e => e.date))].sort().reverse();
    if (dates.length === 0) return { days: 0, startDate: null };

    let streak = 1;
    const today = new Date().toISOString().slice(0, 10);

    if (dates[0] !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (dates[0] !== yesterday) return { days: 0, startDate: null };
    }

    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffDays = (prev.getTime() - curr.getTime()) / 86400000;
      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }

    return { days: streak, startDate: dates[dates.length - 1] || null };
  }

  getLongestStreak(): { days: number; startDate: string; endDate: string } | null {
    const dates = [...new Set(this.workoutLog.getByDateRange('2000-01-01', '2099-12-31').map(e => e.date))].sort();
    if (dates.length === 0) return null;

    let longest = 1;
    let current = 1;
    let bestStart = 0;

    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      if ((curr.getTime() - prev.getTime()) / 86400000 === 1) {
        current++;
        if (current > longest) {
          longest = current;
          bestStart = i - current + 1;
        }
      } else {
        current = 1;
      }
    }

    return { days: longest, startDate: dates[bestStart], endDate: dates[bestStart + longest - 1] };
  }

  getWeeklyGoalProgress(goalDays: number = 4): { completed: number; goal: number; pct: number } {
    const weekStart = getWeekStart(new Date().toISOString().slice(0, 10));
    const weekEntries = this.workoutLog.getByDateRange(weekStart, new Date().toISOString().slice(0, 10));
    const completed = new Set(weekEntries.map(e => e.date)).size;
    return { completed, goal: goalDays, pct: Math.round((completed / goalDays) * 100) };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

export function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
