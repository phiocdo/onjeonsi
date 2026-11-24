/**
 * 서버(Supabase) 공유 별점·태그.
 *
 * - 통계: get_rating_stats(별점·관람 시간)와 get_tag_stats(사용자 태그)를 함께 받아 캐시하고, 화면은
 *   useSyncExternalStore(subscribeStats, getCachedStats)로 읽는다.
 *   두 통계는 따로 받고 따로 반영한다. 한쪽이 실패하거나 늦어도 다른 쪽은 그대로 반영되고,
 *   실패한 쪽만 다음 fetchStats 때 다시 받는다. 한 번도 받지 못한 쪽은 빈 Map이다.
 * - getCachedStats는 상태가 그대로면 같은 참조를 돌려준다(useSyncExternalStore 규칙). 빈 값은 모듈 상수다.
 * - 공유: shareRating이 별점·관람 시간·태그(정리한 값)를 보낸다. 메모와 날짜는 보내지 않는다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { MINUTES_MAX, MINUTES_MIN, RATING_MAX, RATING_MIN } from '../engine/stats';
import { isValidAggregatedStat, type AggregatedStat, type SharedRatingStats } from './ratings';
import { supabase } from './supabase';
import { MAX_TAG_LENGTH, MIN_TAG_USERS, normalizeTags, type UserTagStat } from './userTags';

const FETCH_TIMEOUT_MS = 3000;
const TIMEOUT = Symbol('timeout');

export interface ShareRatingInput {
  exhibitionId: string;
  venueId?: string | null;
  stars: number;
  minutes: number;
  // 사용자 태그. 보낼 때 normalizeTags로 다시 정리하고, 없으면 빈 배열을 보낸다(서버의 예전 태그를 지운다)
  tags?: readonly string[];
}

export type ShareRatingResult = { ok: true } | { ok: false; reason: string };

/** 전시 id → 사용자 태그 (users 많은 순). 서로 다른 사용자 2명 이상이 단 태그만 */
export type TagStats = ReadonlyMap<string, readonly UserTagStat[]>;

/** 화면이 읽는 공유 통계: 별점 통계(ratings.ts) + 사용자 태그 통계 */
export interface SharedStats extends SharedRatingStats {
  tags: TagStats;
}

interface RatingStatRow {
  scope?: unknown;
  id?: unknown;
  count?: unknown;
  avg_stars?: unknown;
  median_minutes?: unknown;
}

interface TagStatRow {
  exhibition_id?: unknown;
  tag?: unknown;
  users?: unknown;
}

// 빈 값은 모듈 상수로 두어 같은 상태에서 같은 참조가 나오게 한다
const EMPTY_RATINGS: SharedRatingStats = { exhibitions: new Map(), venues: new Map() };
const EMPTY_TAGS: TagStats = new Map();
const INITIAL_STATS: SharedStats = { ...EMPTY_RATINGS, tags: EMPTY_TAGS };

let ratingPart: SharedRatingStats = EMPTY_RATINGS;
let tagPart: TagStats = EMPTY_TAGS;
let currentStats: SharedStats = INITIAL_STATS;
// 각 통계를 받아 반영했는지. 둘 다 받았으면 fetchStats는 다시 부르지 않는다
let ratingFresh = false;
let tagsFresh = false;
let inflightFetch: Promise<SharedStats> | null = null;
// 통계 요청 순번. 늦게 도착한 응답이 더 새로운 결과를 덮어쓰지 않게 한다 (별점·태그 따로)
let requestSeq = 0;
let appliedRatingSeq = 0;
let appliedTagSeq = 0;
// 진행 중인 익명 로그인 확인(세션 조회 + 필요하면 로그인). 동시에 공유해도 로그인은 한 번만 한다
let sessionPromise: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

/** 바뀐 부분으로 새 통계 객체를 만들고 알린다 (바뀌지 않았으면 부르지 않는다) */
function publish() {
  currentStats = { exhibitions: ratingPart.exhibitions, venues: ratingPart.venues, tags: tagPart };
  listeners.forEach((fn) => fn());
}

export function getCachedStats(): SharedStats {
  return currentStats;
}

export function subscribeStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetStatsCache(): void {
  ratingPart = EMPTY_RATINGS;
  tagPart = EMPTY_TAGS;
  currentStats = INITIAL_STATS;
  ratingFresh = false;
  tagsFresh = false;
  inflightFetch = null;
  // 초기화 전에 보낸 요청의 늦은 응답은 버린다
  appliedRatingSeq = requestSeq;
  appliedTagSeq = requestSeq;
  sessionPromise = null;
}

/** 별점 통계 응답이 지금 반영된 것보다 새로우면 캐시에 넣고 알린다 */
function applyRatings(seq: number, parsed: SharedRatingStats): void {
  if (seq <= appliedRatingSeq) return;
  appliedRatingSeq = seq;
  ratingFresh = true;
  ratingPart = parsed;
  publish();
}

/** 태그 통계 응답이 지금 반영된 것보다 새로우면 캐시에 넣는다. 빈 결과가 빈 결과를 바꾸는 것은 알리지 않는다 */
function applyTags(seq: number, parsed: TagStats): void {
  if (seq <= appliedTagSeq) return;
  appliedTagSeq = seq;
  tagsFresh = true;
  if (parsed === tagPart) return;
  tagPart = parsed;
  publish();
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

/**
 * get_tag_stats 행 → 전시 id별 태그 목록 (users 많은 순, 같으면 받은 순서).
 * 형식이 틀린 행, 사용자 수가 MIN_TAG_USERS 미만인 행은 버린다. 같은 전시·태그가 두 번 오면 users가 큰 쪽.
 * 결과가 비었으면 EMPTY_TAGS(같은 참조).
 */
export function parseTagRows(rows: readonly unknown[]): TagStats {
  const byExhibition = new Map<string, Map<string, number>>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as TagStatRow;
    if (typeof row.exhibition_id !== 'string' || row.exhibition_id.trim() === '') continue;
    if (typeof row.tag !== 'string') continue;
    const tag = row.tag.trim();
    if (tag === '' || [...tag].length > MAX_TAG_LENGTH) continue;
    // 서버(bigint)는 문자열로 올 수 있다
    const users = Number(row.users);
    if (!Number.isInteger(users) || users < MIN_TAG_USERS) continue;

    let tags = byExhibition.get(row.exhibition_id);
    if (!tags) byExhibition.set(row.exhibition_id, (tags = new Map()));
    tags.set(tag, Math.max(users, tags.get(tag) ?? 0));
  }
  if (byExhibition.size === 0) return EMPTY_TAGS;

  const out = new Map<string, UserTagStat[]>();
  for (const [id, tags] of byExhibition) {
    out.set(
      id,
      [...tags].map(([tag, users]) => ({ tag, users })).sort((a, b) => b.users - a.users),
    );
  }
  return out;
}

/** rpc 하나를 부르고 성공한 응답만 parse 결과로, 실패·형식 오류는 null */
function callRpc<T>(client: SupabaseClient, name: string, parse: (rows: unknown[]) => T): Promise<T | null> {
  return Promise.resolve()
    .then(() => client.rpc(name))
    .then((outcome) => (!outcome || outcome.error || !Array.isArray(outcome.data) ? null : parse(outcome.data)))
    .catch(() => null);
}

/**
 * 응답과 시간 제한 중 먼저 오는 것을 기다린다. 제때 성공하면 바로 반영하고,
 * 시간이 지나면 기다리지 않되 응답이 늦게라도 성공하면 그때 반영한다(늦은 실패는 무시).
 */
async function settle<T>(rpc: Promise<T | null>, timeout: Promise<typeof TIMEOUT>, apply: (value: T) => void): Promise<void> {
  const first = await Promise.race([rpc, timeout]);
  if (first === TIMEOUT) {
    void rpc.then((late) => {
      if (late !== null) apply(late);
    });
    return;
  }
  if (first !== null) apply(first);
}

/** 고른 통계만 받는다. 둘 다 끝나거나(성공·실패) 시간이 지나면 지금 캐시를 돌려준다 */
async function fetchParts(parts: { ratings: boolean; tags: boolean }): Promise<SharedStats> {
  const client = supabase;
  if (!client) return currentStats;

  const seq = ++requestSeq;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), FETCH_TIMEOUT_MS);
  });
  try {
    const jobs: Promise<void>[] = [];
    if (parts.ratings) {
      jobs.push(settle(callRpc(client, 'get_rating_stats', parseStatsRows), timeout, (v) => applyRatings(seq, v)));
    }
    if (parts.tags) {
      jobs.push(settle(callRpc(client, 'get_tag_stats', parseTagRows), timeout, (v) => applyTags(seq, v)));
    }
    await Promise.all(jobs);
  } catch {
    // settle은 예외를 내지 않지만, 혹시 나도 화면은 지금 캐시로 계속 동작한다
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return currentStats;
}

function startFetch(parts: { ratings: boolean; tags: boolean }): Promise<SharedStats> {
  const promise = fetchParts(parts).finally(() => {
    if (inflightFetch === promise) inflightFetch = null;
  });
  inflightFetch = promise;
  return promise;
}

/** 통계를 받는다. 이미 받은 쪽은 다시 받지 않는다(실패한 쪽만 다시) */
export function fetchStats(): Promise<SharedStats> {
  if (!supabase) return Promise.resolve(currentStats);
  if (ratingFresh && tagsFresh) return Promise.resolve(currentStats);
  if (inflightFetch !== null) return inflightFetch;
  return startFetch({ ratings: !ratingFresh, tags: !tagsFresh });
}

/** 공유를 바꾼 뒤 둘 다 다시 받는다. 받기 전까지는 지금 캐시를 그대로 보여 준다 */
export function refreshStats(): Promise<SharedStats> {
  if (!supabase) return Promise.resolve(currentStats);
  ratingFresh = false;
  tagsFresh = false;
  return startFetch({ ratings: true, tags: true });
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
        // 정리한 태그만 (최대 5개, 태그당 1~15자 = 서버 검사). 없으면 빈 배열로 서버의 예전 태그를 지운다
        tags: normalizeTags(input.tags ?? []),
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
