/**
 * ActiveLog.ai — Workout planning engine.
 * WorkoutPlanner, Periodization, DeloadDetector.
 */

import type { WorkoutEntry, ExerciseEntry, RecoveryEntry } from './tracker.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced';
export type TrainingGoal = 'strength' | 'hypertrophy' | 'endurance' | 'fat_loss' | 'general';
export type Phase = 'foundation' | 'volume' | 'intensity' | 'peak' | 'deload';

export interface WorkoutPlan {
  id: string;
  userId: string;
  name: string;
  goal: TrainingGoal;
  level: FitnessLevel;
  weeks: PlanWeek[];
  createdAt: string;
}

export interface PlanWeek {
  weekNumber: number;
  phase: Phase;
  days: PlanDay[];
  targetVolume: number;
  notes?: string;
}

export interface PlanDay {
  dayOfWeek: number;
  name: string;
  type: WorkoutEntry['type'];
  exercises: PlannedExercise[];
}

export interface PlannedExercise {
  name: string;
  targetSets: number;
  targetReps: number;
  targetWeightKg?: number;
  restSeconds: number;
  notes?: string;
}

export interface DeloadRecommendation {
  shouldDeload: boolean;
  reason: string;
  suggestedReductionPct: number;
  indicators: string[];
}

// ─── WorkoutPlanner ─────────────────────────────────────────────────────────

export class WorkoutPlanner {
  generatePlan(goal: TrainingGoal, level: FitnessLevel, daysPerWeek: number): WorkoutPlan {
    const weeks = this.buildMesocycle(goal, level, daysPerWeek);
    return {
      id: generateId(),
      userId: '',
      name: `${capitalize(goal)} Plan (${level})`,
      goal,
      level,
      weeks,
      createdAt: new Date().toISOString().slice(0, 10),
    };
  }

  suggestWorkout(goal: TrainingGoal, level: FitnessLevel, availableMin: number): PlannedExercise[] {
    const exercises = getExercisePool(goal, level);
    const estimatedMinPerExercise = level === 'beginner' ? 8 : 6;
    const maxExercises = Math.floor(availableMin / estimatedMinPerExercise);
    return exercises.slice(0, maxExercises).map(name => {
      const params = getExerciseParams(name, goal, level);
      return {
        name,
        targetSets: params.sets,
        targetReps: params.reps,
        targetWeightKg: params.weight,
        restSeconds: params.rest,
      };
    });
  }

  private buildMesocycle(goal: TrainingGoal, level: FitnessLevel, daysPerWeek: number): PlanWeek[] {
    const totalWeeks = level === 'beginner' ? 6 : level === 'intermediate' ? 8 : 10;
    const deloadWeek = totalWeeks;
    const phaseLength = Math.floor((totalWeeks - 1) / 3);

    const weeks: PlanWeek[] = [];
    for (let w = 1; w <= totalWeeks; w++) {
      let phase: Phase;
      if (w === deloadWeek) {
        phase = 'deload';
      } else if (w <= phaseLength) {
        phase = 'foundation';
      } else if (w <= phaseLength * 2) {
        phase = 'volume';
      } else {
        phase = 'intensity';
      }

      const multiplier = phase === 'deload' ? 0.6 : 1 + (w / totalWeeks) * 0.15;
      const days = this.buildWeekDays(goal, level, daysPerWeek, multiplier, phase);

      weeks.push({
        weekNumber: w,
        phase,
        days,
        targetVolume: Math.round(multiplier * 100),
        notes: phase === 'deload' ? 'Reduce volume 40%, maintain intensity' : undefined,
      });
    }
    return weeks;
  }

  private buildWeekDays(goal: TrainingGoal, level: FitnessLevel, daysPerWeek: number, multiplier: number, phase: Phase): PlanDay[] {
    const exercises = getExercisePool(goal, level);
    const days: PlanDay[] = [];

    const splits = this.getSplit(daysPerWeek, exercises.length);
    for (let d = 0; d < daysPerWeek; d++) {
      const dayExercises = splits[d] || [];
      days.push({
        dayOfWeek: d + 1,
        name: `Day ${d + 1}`,
        type: goal === 'endurance' ? 'cardio' : 'strength',
        exercises: dayExercises.map(name => {
          const params = getExerciseParams(name, goal, level);
          return {
            name,
            targetSets: Math.round(params.sets * (phase === 'deload' ? 0.6 : multiplier)),
            targetReps: params.reps,
            targetWeightKg: params.weight,
            restSeconds: params.rest,
          };
        }),
      });
    }
    return days;
  }

  private getSplit(daysPerWeek: number, exerciseCount: number): string[][] {
    if (daysPerWeek <= 2) {
      return [Array.from({ length: exerciseCount }, (_, i) => `Exercise ${i + 1}`)];
    }
    const perDay = Math.ceil(exerciseCount / daysPerWeek);
    const splits: string[][] = [];
    for (let d = 0; d < daysPerWeek; d++) {
      splits.push(Array.from({ length: perDay }, (_, i) => `Exercise ${d * perDay + i + 1}`));
    }
    return splits;
  }
}

// ─── Periodization ──────────────────────────────────────────────────────────

export class Periodization {
  private plan: WorkoutPlan | null = null;

  setPlan(plan: WorkoutPlan): void {
    this.plan = plan;
  }

  getCurrentWeek(currentDate: string): PlanWeek | null {
    if (!this.plan) return null;
    const startDate = new Date(this.plan.createdAt);
    const now = new Date(currentDate);
    const weekNum = Math.floor((now.getTime() - startDate.getTime()) / (7 * 86400000)) + 1;
    return this.plan.weeks.find(w => w.weekNumber === weekNum) || null;
  }

  getCurrentPhase(currentDate: string): Phase | null {
    const week = this.getCurrentWeek(currentDate);
    return week?.phase || null;
  }

  getProgressiveLoad(weekNumber: number): { setsMultiplier: number; repsMultiplier: number; weightMultiplier: number } {
    if (!this.plan) return { setsMultiplier: 1, repsMultiplier: 1, weightMultiplier: 1 };
    const week = this.plan.weeks.find(w => w.weekNumber === weekNumber);
    if (!week) return { setsMultiplier: 1, repsMultiplier: 1, weightMultiplier: 1 };

    switch (week.phase) {
      case 'foundation':
        return { setsMultiplier: 0.8, repsMultiplier: 1, weightMultiplier: 0.7 };
      case 'volume':
        return { setsMultiplier: 1.2, repsMultiplier: 1.1, weightMultiplier: 0.85 };
      case 'intensity':
        return { setsMultiplier: 0.9, repsMultiplier: 0.8, weightMultiplier: 1.1 };
      case 'peak':
        return { setsMultiplier: 0.7, repsMultiplier: 0.7, weightMultiplier: 1.15 };
      case 'deload':
        return { setsMultiplier: 0.6, repsMultiplier: 1, weightMultiplier: 0.8 };
    }
  }

  getNextPhase(currentPhase: Phase): Phase {
    const order: Phase[] = ['foundation', 'volume', 'intensity', 'peak', 'deload'];
    const idx = order.indexOf(currentPhase);
    return order[(idx + 1) % order.length];
  }

  getPhaseDescription(phase: Phase): string {
    const descriptions: Record<Phase, string> = {
      foundation: 'Building base strength and movement patterns. Moderate volume, controlled weights.',
      volume: 'Increasing training volume to stimulate muscle growth and work capacity.',
      intensity: 'Pushing heavier loads to build maximal strength. Lower reps, higher weight.',
      peak: 'Peak performance week. Near max efforts with minimal volume.',
      deload: 'Recovery week. Reduce volume 40% to allow adaptation and prevent overtraining.',
    };
    return descriptions[phase];
  }
}

// ─── DeloadDetector ─────────────────────────────────────────────────────────

export class DeloadDetector {
  /**
   * Analyze recent workout + recovery data and recommend whether to deload.
   */
  analyze(
    recentWorkouts: WorkoutEntry[],
    recentRecovery: RecoveryEntry[],
    streakDays: number,
  ): DeloadRecommendation {
    const indicators: string[] = [];
    let score = 0;

    // Check training streak
    if (streakDays >= 28) {
      score += 3;
      indicators.push(`Training streak of ${streakDays} days without a deload`);
    } else if (streakDays >= 21) {
      score += 2;
      indicators.push(`${streakDays}-day training streak — approaching deload window`);
    }

    // Check recovery trends
    if (recentRecovery.length >= 3) {
      const recent = recentRecovery.slice(-3);
      const avgEnergy = recent.reduce((s, r) => s + r.energyLevel, 0) / recent.length;
      const avgSoreness = recent.reduce((s, r) => s + r.soreness, 0) / recent.length;

      if (avgEnergy <= 2.5) {
        score += 3;
        indicators.push('Low energy levels across recent sessions');
      }
      if (avgSoreness >= 4) {
        score += 3;
        indicators.push('High soreness persisting between sessions');
      }
    }

    // Check workout volume trend
    if (recentWorkouts.length >= 4) {
      const recent4 = recentWorkouts.slice(-4);
      const durations = recent4.map(w => w.durationMin);
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      if (avgDuration > 90) {
        score += 1;
        indicators.push('Average session duration exceeds 90 minutes');
      }
    }

    // Check RPE inflation
    if (recentWorkouts.length >= 2) {
      const recentExercises = recentWorkouts.slice(-2).flatMap(w => w.exercises);
      const highRpeSets = recentExercises
        .flatMap(e => e.sets || [])
        .filter(s => (s.rpe || 0) >= 9);
      if (highRpeSets.length >= 3) {
        score += 2;
        indicators.push('Multiple sets at RPE 9+ in recent sessions');
      }
    }

    const shouldDeload = score >= 5;
    return {
      shouldDeload,
      reason: shouldDeload
        ? `Accumulated fatigue detected (${indicators.length} indicators, score ${score}/11). Recommend a deload week.`
        : `Recovery looks manageable (${indicators.length} minor indicators, score ${score}/11). Continue training.`,
      suggestedReductionPct: shouldDeload ? 40 : (score >= 3 ? 20 : 0),
      indicators,
    };
  }
}

// ─── Exercise Database (simplified) ─────────────────────────────────────────

function getExercisePool(goal: TrainingGoal, level: FitnessLevel): string[] {
  const pools: Record<TrainingGoal, string[]> = {
    strength: ['Squat', 'Bench Press', 'Deadlift', 'Overhead Press', 'Barbell Row', 'Pull-up', 'Dip'],
    hypertrophy: ['Incline Bench', 'Leg Press', 'Lat Pulldown', 'Lateral Raise', 'Leg Curl', 'Cable Fly', 'Bicep Curl', 'Tricep Extension'],
    endurance: ['Running', 'Cycling', 'Rowing', 'Swimming', 'Jump Rope', 'Burpees'],
    fat_loss: ['Squat', 'Deadlift', 'Kettlebell Swing', 'Box Jump', 'Battle Ropes', 'Mountain Climbers', 'Sprint Intervals'],
    general: ['Squat', 'Push-up', 'Pull-up', 'Lunges', 'Plank', 'Deadlift', 'Overhead Press'],
  };
  const pool = pools[goal] || pools.general;
  if (level === 'beginner') return pool.slice(0, 5);
  return pool;
}

function getExerciseParams(name: string, goal: TrainingGoal, level: FitnessLevel): { sets: number; reps: number; weight: number; rest: number } {
  const base = {
    strength: { sets: 4, reps: 5, rest: 180 },
    hypertrophy: { sets: 4, reps: 10, rest: 90 },
    endurance: { sets: 3, reps: 15, rest: 60 },
    fat_loss: { sets: 3, reps: 12, rest: 45 },
    general: { sets: 3, reps: 8, rest: 90 },
  };
  const params = base[goal] || base.general;
  const levelMultiplier = level === 'beginner' ? 0.75 : level === 'advanced' ? 1.2 : 1;
  return {
    sets: Math.round(params.sets * (level === 'beginner' ? 0.8 : 1)),
    reps: params.reps,
    weight: 0, // User-specified
    rest: Math.round(params.rest * levelMultiplier),
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ');
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
