import {
  MIN_COUNT,
  MINUTES_MAX,
  MINUTES_MIN,
  RATING_MAX,
  RATING_MIN,
} from '../engine/stats';
import type { AggregatedStat, SharedRatingStats } from './ratings';
import { supabase } from './supabase';

const FETCH_TIMEOUT_MS = 3000;
const TIMEOUT = Symbol('timeout');

export interface ShareRatingInput {
  exhibitionId: string;
  venueId?: string | null;
  stars: number;
  minutes: number;
}

export type ShareRatingResult = { ok: true } | { ok: false; reason: string };

interface RatingStatRow {
  scope?: unknown;
  id?: unknown;
  count?: unknown;
  avg_stars?: unknown;
  median_minutes?: unknown;
}

function emptyStats(): SharedRatingStats {
  return { exhibitions: new Map(), venues: new Map() };
}

const INITIAL_STATS: SharedRatingStats = emptyStats();
let cachedStats: SharedRatingStats | null = null;
let currentStats: SharedRatingStats = INITIAL_STATS;
let inflightFetch: Promise<SharedRatingStats> | null = null;
const listeners = new Set<() => void>();

function notify(next: SharedRatingStats) {
  currentStats = next;
  listeners.forEach((fn) => fn());
}

export function getCachedStats(): SharedRatingStats {
  return currentStats;
}

export function subscribeStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetStatsCache(): void {
  cachedStats = null;
  inflightFetch = null;
  currentStats = INITIAL_STATS;
}

function parseStatsRows(rows: unknown[]): SharedRatingStats {
  const exhibitions = new Map<string, AggregatedStat>();
  const venues = new Map<string, AggregatedStat>();

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as RatingStatRow;
    if (typeof row.id !== 'string' || row.id.trim() === '') continue;

    const count = Number(row.count);
    const averageRating = Number(row.avg_stars);
    const medianMinutes = Number(row.median_minutes);

    if (
      !Number.isInteger(count) ||
      count < MIN_COUNT ||
      !Number.isFinite(averageRating) ||
      averageRating < RATING_MIN ||
      averageRating > RATING_MAX ||
      !Number.isFinite(medianMinutes) ||
      medianMinutes < MINUTES_MIN ||
      medianMinutes > MINUTES_MAX
    ) {
      continue;
    }

    const stat: AggregatedStat = { count, averageRating, medianMinutes };
    if (row.scope === 'exhibition') {
      exhibitions.set(row.id, stat);
    } else if (row.scope === 'venue') {
      venues.set(row.id, stat);
    }
  }

  return { exhibitions, venues };
}

async function fetchStatsOnce(): Promise<SharedRatingStats> {
  const client = supabase;
  if (!client) return emptyStats();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rpcPromise = Promise.resolve()
      .then(() => client.rpc('get_rating_stats'))
      .catch(() => ({ data: null, error: new Error('rpc_failed') }));

    const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), FETCH_TIMEOUT_MS);
    });

    const outcome = await Promise.race([rpcPromise, timeoutPromise]);
    if (outcome === TIMEOUT) return emptyStats();
    if (!outcome || outcome.error || !Array.isArray(outcome.data)) return emptyStats();

    const parsed = parseStatsRows(outcome.data);
    cachedStats = parsed;
    notify(parsed);
    return parsed;
  } catch {
    return emptyStats();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function fetchStats(): Promise<SharedRatingStats> {
  if (!supabase) return Promise.resolve(emptyStats());
  if (cachedStats !== null) return Promise.resolve(cachedStats);
  if (inflightFetch !== null) return inflightFetch;

  const promise = fetchStatsOnce().finally(() => {
    if (inflightFetch === promise) inflightFetch = null;
  });
  inflightFetch = promise;
  return promise;
}

export function refreshStats(): Promise<SharedRatingStats> {
  if (!supabase) return Promise.resolve(emptyStats());
  cachedStats = null;
  const promise = fetchStatsOnce().finally(() => {
    if (inflightFetch === promise) inflightFetch = null;
  });
  inflightFetch = promise;
  return promise;
}

function isValidShareInput(input: ShareRatingInput): boolean {
  if (!input || typeof input !== 'object') return false;
  if (typeof input.exhibitionId !== 'string' || input.exhibitionId.trim() === '') return false;

  const { stars, minutes } = input;
  if (
    typeof stars !== 'number' ||
    !Number.isInteger(stars) ||
    stars < RATING_MIN ||
    stars > RATING_MAX
  ) {
    return false;
  }
  if (
    typeof minutes !== 'number' ||
    !Number.isInteger(minutes) ||
    minutes < MINUTES_MIN ||
    minutes > MINUTES_MAX
  ) {
    return false;
  }
  return true;
}

export async function shareRating(input: ShareRatingInput): Promise<ShareRatingResult> {
  const client = supabase;
  if (!client) return { ok: false, reason: 'disabled' };
  if (!isValidShareInput(input)) return { ok: false, reason: 'invalid' };

  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      return { ok: false, reason: sessionError.message || 'auth_failed' };
    }

    if (!sessionData.session) {
      const { error: signInError } = await client.auth.signInAnonymously();
      if (signInError) {
        return { ok: false, reason: signInError.message || 'auth_failed' };
      }
    }

    const venueId =
      typeof input.venueId === 'string' && input.venueId.trim() !== ''
        ? input.venueId.trim()
        : null;

    const { error } = await client.from('shared_ratings').upsert(
      {
        exhibition_id: input.exhibitionId.trim(),
        venue_id: venueId,
        stars: input.stars,
        minutes: input.minutes,
      },
      { onConflict: 'exhibition_id,user_id' },
    );

    if (error) {
      return { ok: false, reason: error.message || 'upsert_failed' };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error && err.message ? err.message : 'unknown',
    };
  }
}

export async function deleteMyShared(exhibitionId?: string): Promise<ShareRatingResult> {
  const client = supabase;
  if (!client) return { ok: false, reason: 'disabled' };
  if (exhibitionId !== undefined && (typeof exhibitionId !== 'string' || exhibitionId.trim() === '')) {
    return { ok: false, reason: 'invalid' };
  }

  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      return { ok: false, reason: sessionError.message || 'auth_failed' };
    }
    if (!sessionData.session) {
      return { ok: false, reason: 'no_session' };
    }

    if (exhibitionId !== undefined) {
      const { error } = await client
        .from('shared_ratings')
        .delete()
        .eq('exhibition_id', exhibitionId.trim());
      if (error) return { ok: false, reason: error.message || 'delete_failed' };
      return { ok: true };
    }

    const userId = sessionData.session.user?.id;
    if (!userId) return { ok: false, reason: 'no_user' };

    const { error } = await client.from('shared_ratings').delete().eq('user_id', userId);
    if (error) return { ok: false, reason: error.message || 'delete_failed' };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error && err.message ? err.message : 'unknown',
    };
  }
}
