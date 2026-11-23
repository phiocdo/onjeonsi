import type { SupabaseClient } from '@supabase/supabase-js';
import { MINUTES_MAX, MINUTES_MIN, RATING_MAX, RATING_MIN } from '../engine/stats';
import { isValidAggregatedStat, type AggregatedStat, type SharedRatingStats } from './ratings';
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
// 통계 요청 순번. 늦게 도착한 응답이 더 새로운 결과를 덮어쓰지 않게 한다
let requestSeq = 0;
let appliedSeq = 0;
// 진행 중인 익명 로그인 확인(세션 조회 + 필요하면 로그인). 동시에 공유해도 로그인은 한 번만 한다
let sessionPromise: Promise<string | null> | null = null;
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
  // 초기화 전에 보낸 요청의 늦은 응답은 버린다
  appliedSeq = requestSeq;
  sessionPromise = null;
}

/** 응답 순번이 지금 반영된 것보다 새로우면 캐시에 넣고 알린다 */
function applyStats(seq: number, parsed: SharedRatingStats): boolean {
  if (seq <= appliedSeq) return false;
  appliedSeq = seq;
  cachedStats = parsed;
  notify(parsed);
  return true;
}

function parseStatsRows(rows: unknown[]): SharedRatingStats {
  const exhibitions = new Map<string, AggregatedStat>();
  const venues = new Map<string, AggregatedStat>();

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as RatingStatRow;
    if (typeof row.id !== 'string' || row.id.trim() === '') continue;

    // 서버(numeric)는 문자열로 올 수 있어 숫자로 바꾼 뒤, 범위 검사는 화면 읽기(ratings.ts)와 같은 것을 쓴다
    const stat: AggregatedStat = {
      count: Number(row.count),
      averageRating: Number(row.avg_stars),
      medianMinutes: Number(row.median_minutes),
    };
    if (!isValidAggregatedStat(stat)) continue;

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

  const seq = ++requestSeq;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 성공한 응답만 통계로 바꾸고, 실패·형식 오류는 null
    const rpcPromise: Promise<SharedRatingStats | null> = Promise.resolve()
      .then(() => client.rpc('get_rating_stats'))
      .then((outcome) =>
        !outcome || outcome.error || !Array.isArray(outcome.data) ? null : parseStatsRows(outcome.data),
      )
      .catch(() => null);

    const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), FETCH_TIMEOUT_MS);
    });

    const outcome = await Promise.race([rpcPromise, timeoutPromise]);
    if (outcome === TIMEOUT) {
      // 화면은 기다리지 않게 빈 통계를 주고, 응답이 늦게라도 성공하면 그때 반영한다 (늦은 실패는 무시)
      void rpcPromise.then((late) => {
        if (late) applyStats(seq, late);
      });
      return emptyStats();
    }
    if (!outcome) return emptyStats();

    // 더 새 요청의 결과가 이미 반영되어 있으면 그것을 둔다
    if (!applyStats(seq, outcome)) return currentStats;
    return outcome;
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

/**
 * 세션이 없으면 익명 로그인. 실패하면 이유, 성공하면 null.
 * 세션 조회와 로그인을 한 Promise로 묶어 동시에 들어온 호출이 같이 기다리게 하므로
 * 두 번 눌러도 익명 사용자가 둘 생기지 않는다. 끝나면 비우고, 그 뒤 호출은 세션이 있어 로그인하지 않는다.
 */
function ensureSession(client: SupabaseClient): Promise<string | null> {
  if (sessionPromise) return sessionPromise;
  const promise = (async () => {
    const { data, error } = await client.auth.getSession();
    if (error) return error.message || 'auth_failed';
    if (data.session) return null;
    const { error: signInError } = await client.auth.signInAnonymously();
    return signInError ? signInError.message || 'auth_failed' : null;
  })()
    .catch((err: unknown) => (err instanceof Error && err.message ? err.message : 'auth_failed'))
    .finally(() => {
      if (sessionPromise === promise) sessionPromise = null;
    });
  sessionPromise = promise;
  return promise;
}

export async function shareRating(input: ShareRatingInput): Promise<ShareRatingResult> {
  const client = supabase;
  if (!client) return { ok: false, reason: 'disabled' };
  if (!isValidShareInput(input)) return { ok: false, reason: 'invalid' };

  try {
    const authError = await ensureSession(client);
    if (authError) return { ok: false, reason: authError };

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
