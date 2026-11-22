import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockSupabase {
  rpc: ReturnType<typeof vi.fn>;
  auth: {
    getSession: ReturnType<typeof vi.fn>;
    signInAnonymously: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
}

let mockClient: MockSupabase | null = null;

vi.mock('./supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

import {
  deleteMyShared,
  fetchStats,
  getCachedStats,
  refreshStats,
  resetStatsCache,
  shareRating,
  subscribeStats,
} from './sharedRatings';

function makeMockClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const eq = vi.fn().mockResolvedValue({ error: null });
  const del = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ upsert, delete: del });
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
  const signInAnonymously = vi.fn().mockResolvedValue({ data: { session: { user: { id: 'anon-1' } } }, error: null });

  const client: MockSupabase = {
    rpc,
    auth: { getSession, signInAnonymously },
    from,
  };
  return { client, rpc, getSession, signInAnonymously, from, upsert, del, eq };
}

beforeEach(() => {
  mockClient = null;
  resetStatsCache();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('클라이언트 없음 (환경변수 미설정)', () => {
  it('fetchStats는 빈 Map 두 개를 반환한다', async () => {
    const stats = await fetchStats();
    expect(stats.exhibitions.size).toBe(0);
    expect(stats.venues.size).toBe(0);
  });

  it('shareRating은 disabled를 반환하고 예외를 던지지 않는다', async () => {
    const res = await shareRating({
      exhibitionId: 'ex-1',
      venueId: 'venue-sema',
      stars: 5,
      minutes: 60,
    });
    expect(res).toEqual({ ok: false, reason: 'disabled' });
  });

  it('deleteMyShared는 disabled를 반환하고 아무것도 하지 않는다', async () => {
    const res = await deleteMyShared('ex-1');
    expect(res).toEqual({ ok: false, reason: 'disabled' });
  });
});

describe('fetchStats', () => {
  it('rpc 성공 시 전시·시설 Map으로 변환하고 캐시한다', async () => {
    const { client, rpc } = makeMockClient();
    rpc.mockResolvedValue({
      data: [
        { scope: 'exhibition', id: 'ex-1', count: 5, avg_stars: 4.4, median_minutes: 60 },
        { scope: 'venue', id: 'venue-sema', count: '12', avg_stars: '4.1', median_minutes: '75' },
        { scope: 'exhibition', id: 'ex-small', count: 2, avg_stars: 5, median_minutes: 30 },
        { scope: 'unknown', id: 'x', count: 10, avg_stars: 4, median_minutes: 50 },
      ],
      error: null,
    });
    mockClient = client;

    const first = await fetchStats();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_rating_stats');
    expect(first.exhibitions.get('ex-1')).toEqual({
      count: 5,
      averageRating: 4.4,
      medianMinutes: 60,
    });
    expect(first.exhibitions.has('ex-small')).toBe(false);
    expect(first.venues.get('venue-sema')).toEqual({
      count: 12,
      averageRating: 4.1,
      medianMinutes: 75,
    });
    expect(getCachedStats()).toBe(first);

    // 두 번째 호출은 캐시를 반환하고 rpc를 다시 부르지 않는다
    const second = await fetchStats();
    expect(second).toBe(first);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('rpc 에러 반환 시 빈 통계를 반환한다', async () => {
    const { client, rpc } = makeMockClient();
    rpc.mockResolvedValue({ data: null, error: { message: 'db error' } });
    mockClient = client;

    const stats = await fetchStats();
    expect(stats.exhibitions.size).toBe(0);
    expect(stats.venues.size).toBe(0);
  });

  it('rpc 예외(reject) 시 빈 통계를 반환한다', async () => {
    const { client, rpc } = makeMockClient();
    rpc.mockRejectedValue(new Error('network down'));
    mockClient = client;

    const stats = await fetchStats();
    expect(stats.exhibitions.size).toBe(0);
    expect(stats.venues.size).toBe(0);
  });

  it('3초 시간 초과 시 빈 통계를 반환한다', async () => {
    vi.useFakeTimers();
    const { client, rpc } = makeMockClient();
    rpc.mockImplementation(() => new Promise(() => {}));
    mockClient = client;

    const pending = fetchStats();
    await vi.advanceTimersByTimeAsync(3000);
    const stats = await pending;

    expect(stats.exhibitions.size).toBe(0);
    expect(stats.venues.size).toBe(0);
  });

  it('시간 초과 뒤 응답이 늦게 성공하면 캐시를 갱신하고 구독자에게 알린다', async () => {
    vi.useFakeTimers();
    const { client, rpc } = makeMockClient();
    let resolveRpc!: (v: unknown) => void;
    rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    mockClient = client;
    const listener = vi.fn();
    const unsubscribe = subscribeStats(listener);

    const pending = fetchStats();
    await vi.advanceTimersByTimeAsync(3000);
    expect((await pending).exhibitions.size).toBe(0);
    expect(listener).not.toHaveBeenCalled();

    resolveRpc({ data: [{ scope: 'exhibition', id: 'ex-late', count: 4, avg_stars: 4, median_minutes: 50 }], error: null });
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCachedStats().exhibitions.get('ex-late')).toEqual({ count: 4, averageRating: 4, medianMinutes: 50 });
    // 캐시에 들어갔으니 다시 부르지 않는다
    await fetchStats();
    expect(rpc).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('시간 초과 뒤 응답이 늦게 실패하면 아무것도 바뀌지 않는다', async () => {
    vi.useFakeTimers();
    const { client, rpc } = makeMockClient();
    let rejectRpc!: (e: unknown) => void;
    rpc.mockImplementation(() => new Promise((_, reject) => { rejectRpc = reject; }));
    mockClient = client;
    const listener = vi.fn();
    const unsubscribe = subscribeStats(listener);
    const before = getCachedStats();

    const pending = fetchStats();
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    rejectRpc(new Error('late network error'));
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).not.toHaveBeenCalled();
    expect(getCachedStats()).toBe(before);
    unsubscribe();
  });

  it('늦게 도착한 옛 응답은 더 새로운 결과를 덮어쓰지 않는다', async () => {
    vi.useFakeTimers();
    const { client, rpc } = makeMockClient();
    let resolveOld!: (v: unknown) => void;
    rpc
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ data: [{ scope: 'venue', id: 'v-new', count: 3, avg_stars: 5, median_minutes: 30 }], error: null });
    mockClient = client;

    const first = fetchStats();
    await vi.advanceTimersByTimeAsync(3000);
    await first;
    const fresh = await refreshStats();
    expect(fresh.venues.has('v-new')).toBe(true);

    resolveOld({ data: [{ scope: 'venue', id: 'v-old', count: 3, avg_stars: 1, median_minutes: 30 }], error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(getCachedStats()).toBe(fresh);
  });
});

describe('shareRating', () => {
  it('동시에 두 번 공유해도 익명 로그인은 한 번만 한다', async () => {
    const { client, getSession, signInAnonymously, upsert } = makeMockClient();
    let finishSignIn!: () => void;
    signInAnonymously.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSignIn = () => {
            // 로그인이 끝나면 세션이 생긴다
            getSession.mockResolvedValue({ data: { session: { user: { id: 'anon-1' } } }, error: null });
            resolve({ data: { session: { user: { id: 'anon-1' } } }, error: null });
          };
        }),
    );
    mockClient = client;

    const a = shareRating({ exhibitionId: 'ex-1', venueId: null, stars: 4, minutes: 60 });
    const b = shareRating({ exhibitionId: 'ex-2', venueId: null, stars: 5, minutes: 90 });
    await vi.waitFor(() => expect(signInAnonymously).toHaveBeenCalled());
    finishSignIn();

    expect(await Promise.all([a, b])).toEqual([{ ok: true }, { ok: true }]);
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(2);

    // 세션이 생긴 뒤에는 다시 로그인하지 않는다
    await shareRating({ exhibitionId: 'ex-3', venueId: null, stars: 3, minutes: 40 });
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('익명 로그인이 실패하면 다음 공유 때 다시 시도한다', async () => {
    const { client, signInAnonymously, upsert } = makeMockClient();
    signInAnonymously
      .mockResolvedValueOnce({ data: null, error: { message: 'captcha' } })
      .mockResolvedValue({ data: { session: { user: { id: 'anon-1' } } }, error: null });
    mockClient = client;

    expect(await shareRating({ exhibitionId: 'ex-1', venueId: null, stars: 4, minutes: 60 })).toEqual({ ok: false, reason: 'captcha' });
    expect(upsert).not.toHaveBeenCalled();
    expect(await shareRating({ exhibitionId: 'ex-1', venueId: null, stars: 4, minutes: 60 })).toEqual({ ok: true });
    expect(signInAnonymously).toHaveBeenCalledTimes(2);
  });

  it('세션이 없을 때만 signInAnonymously 후 upsert를 호출하고 user_id는 보내지 않는다', async () => {
    const { client, getSession, signInAnonymously, from, upsert } = makeMockClient();
    mockClient = client;

    const res = await shareRating({
      exhibitionId: 'ex-1',
      venueId: 'venue-sema',
      stars: 4,
      minutes: 90,
    });

    expect(res).toEqual({ ok: true });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('shared_ratings');
    expect(upsert).toHaveBeenCalledWith(
      {
        exhibition_id: 'ex-1',
        venue_id: 'venue-sema',
        stars: 4,
        minutes: 90,
      },
      { onConflict: 'exhibition_id,user_id' },
    );
    const sentRow = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sentRow).sort()).toEqual(['exhibition_id', 'minutes', 'stars', 'venue_id']);
    expect('user_id' in sentRow).toBe(false);
  });

  it('세션이 이미 있으면 signInAnonymously를 호출하지 않는다', async () => {
    const { client, getSession, signInAnonymously, upsert } = makeMockClient();
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u-1' } } }, error: null });
    mockClient = client;

    const res = await shareRating({
      exhibitionId: 'ex-2',
      venueId: null,
      stars: 5,
      minutes: 120,
    });

    expect(res).toEqual({ ok: true });
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      {
        exhibition_id: 'ex-2',
        venue_id: null,
        stars: 5,
        minutes: 120,
      },
      { onConflict: 'exhibition_id,user_id' },
    );
  });

  it('범위 밖 값이나 비정수는 서버로 보내지 않는다', async () => {
    const { client, getSession, signInAnonymously, from } = makeMockClient();
    mockClient = client;

    const invalidInputs = [
      { exhibitionId: 'ex-1', venueId: null, stars: 0, minutes: 60 },
      { exhibitionId: 'ex-1', venueId: null, stars: 6, minutes: 60 },
      { exhibitionId: 'ex-1', venueId: null, stars: 3.5, minutes: 60 },
      { exhibitionId: 'ex-1', venueId: null, stars: 4, minutes: 9 },
      { exhibitionId: 'ex-1', venueId: null, stars: 4, minutes: 481 },
      { exhibitionId: 'ex-1', venueId: null, stars: 4, minutes: 60.5 },
      { exhibitionId: '   ', venueId: null, stars: 4, minutes: 60 },
    ];

    for (const input of invalidInputs) {
      const res = await shareRating(input);
      expect(res).toEqual({ ok: false, reason: 'invalid' });
    }

    expect(getSession).not.toHaveBeenCalled();
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('upsert 에러 반환 시 예외 없이 ok:false를 반환한다', async () => {
    const { client, getSession, upsert } = makeMockClient();
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u-1' } } }, error: null });
    upsert.mockResolvedValue({ error: { message: 'rls denied' } });
    mockClient = client;

    const res = await shareRating({
      exhibitionId: 'ex-1',
      venueId: 'venue-mmca',
      stars: 5,
      minutes: 60,
    });
    expect(res).toEqual({ ok: false, reason: 'rls denied' });
  });

  it('upsert가 예외를 던져도 ok:false를 반환한다', async () => {
    const { client, getSession, upsert } = makeMockClient();
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u-1' } } }, error: null });
    upsert.mockRejectedValue(new Error('offline'));
    mockClient = client;

    const res = await shareRating({
      exhibitionId: 'ex-1',
      venueId: null,
      stars: 3,
      minutes: 45,
    });
    expect(res).toEqual({ ok: false, reason: 'offline' });
  });
});

describe('deleteMyShared', () => {
  it('세션이 없으면 로그인하지 않고 삭제도 호출하지 않는다', async () => {
    const { client, signInAnonymously, from } = makeMockClient();
    mockClient = client;

    const res = await deleteMyShared('ex-1');
    expect(res).toEqual({ ok: false, reason: 'no_session' });
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('세션이 있고 exhibitionId를 주면 해당 전시 행만 삭제한다', async () => {
    const { client, getSession, from, del, eq } = makeMockClient();
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u-1' } } }, error: null });
    mockClient = client;

    const res = await deleteMyShared('ex-1');
    expect(res).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith('shared_ratings');
    expect(del).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('exhibition_id', 'ex-1');
  });

  it('세션이 있고 exhibitionId를 생략하면 자기 행 전체를 삭제한다', async () => {
    const { client, getSession, from, del, eq } = makeMockClient();
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u-1' } } }, error: null });
    mockClient = client;

    const res = await deleteMyShared();
    expect(res).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith('shared_ratings');
    expect(del).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('user_id', 'u-1');
  });
});
