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
  // rpc: 별점 통계(get_rating_stats), tagRpc: 태그 통계(get_tag_stats). 클라이언트의 rpc는 이름으로 나눠 부른다
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  const tagRpc = vi.fn().mockResolvedValue({ data: [], error: null });
  const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
  const signInAnonymously = vi.fn().mockResolvedValue({ data: { session: { user: { id: 'anon-1' } } }, error: null });

  const client: MockSupabase = {
    rpc: vi.fn((name: string) => (name === 'get_tag_stats' ? tagRpc(name) : rpc(name))),
    auth: { getSession, signInAnonymously },
    from,
  };
  return { client, rpc, tagRpc, getSession, signInAnonymously, from, upsert, del, eq };
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

describe('fetchStats 태그 통계', () => {
  const RATING_ROW = { scope: 'exhibition', id: 'ex-1', count: 5, avg_stars: 4.4, median_minutes: 60 };

  it('rpc 성공 → 전시 id별 [{ tag, users }] Map (users 많은 순, 잘못된 행·1명 태그는 버림)', async () => {
    const { client, tagRpc } = makeMockClient();
    tagRpc.mockResolvedValue({
      data: [
        { exhibition_id: 'ex-1', tag: '조용함', users: 2 },
        { exhibition_id: 'ex-1', tag: '사진 찍기 좋음', users: '4' },
        { exhibition_id: 'ex-2', tag: '데이트', users: 3 },
        { exhibition_id: 'ex-2', tag: '혼자', users: 1 },
        { exhibition_id: 'ex-2', tag: '가'.repeat(16), users: 9 },
        { exhibition_id: '', tag: 'x', users: 5 },
        { exhibition_id: 'ex-3', tag: 7, users: 5 },
        null,
      ],
      error: null,
    });
    mockClient = client;

    const stats = await fetchStats();
    expect(tagRpc).toHaveBeenCalledWith('get_tag_stats');
    expect(stats.tags.get('ex-1')).toEqual([
      { tag: '사진 찍기 좋음', users: 4 },
      { tag: '조용함', users: 2 },
    ]);
    expect(stats.tags.get('ex-2')).toEqual([{ tag: '데이트', users: 3 }]);
    expect(stats.tags.has('ex-3')).toBe(false);
    expect(getCachedStats()).toBe(stats);
  });

  it('태그 rpc 실패(에러·예외·시간 초과) → 빈 Map, 별점 통계는 그대로', async () => {
    for (const fail of ['error', 'reject'] as const) {
      resetStatsCache();
      const { client, rpc, tagRpc } = makeMockClient();
      rpc.mockResolvedValue({ data: [RATING_ROW], error: null });
      if (fail === 'error') tagRpc.mockResolvedValue({ data: null, error: { message: 'no function' } });
      else tagRpc.mockRejectedValue(new Error('network'));
      mockClient = client;

      const stats = await fetchStats();
      expect(stats.tags.size).toBe(0);
      expect(stats.exhibitions.get('ex-1')?.count).toBe(5);
    }
  });

  it('별점 rpc만 실패 → 태그 통계는 반영된다', async () => {
    const { client, rpc, tagRpc } = makeMockClient();
    rpc.mockResolvedValue({ data: null, error: { message: 'db error' } });
    tagRpc.mockResolvedValue({ data: [{ exhibition_id: 'ex-1', tag: '조용함', users: 2 }], error: null });
    mockClient = client;

    const stats = await fetchStats();
    expect(stats.exhibitions.size).toBe(0);
    expect(stats.tags.get('ex-1')).toEqual([{ tag: '조용함', users: 2 }]);
  });

  it('실패한 쪽만 다음 fetchStats 때 다시 받는다', async () => {
    const { client, rpc, tagRpc } = makeMockClient();
    rpc.mockResolvedValue({ data: [RATING_ROW], error: null });
    tagRpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } }).mockResolvedValue({ data: [{ exhibition_id: 'ex-1', tag: '조용함', users: 2 }], error: null });
    mockClient = client;

    await fetchStats();
    const again = await fetchStats();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(tagRpc).toHaveBeenCalledTimes(2);
    expect(again.tags.get('ex-1')).toHaveLength(1);
    expect(again.exhibitions.get('ex-1')?.count).toBe(5);

    // 둘 다 받았으면 다시 부르지 않는다
    expect(await fetchStats()).toBe(again);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(tagRpc).toHaveBeenCalledTimes(2);
  });

  it('태그 rpc가 시간 초과여도 별점은 바로 반영되고, 태그는 늦게 성공하면 그때 알린다', async () => {
    vi.useFakeTimers();
    const { client, rpc, tagRpc } = makeMockClient();
    rpc.mockResolvedValue({ data: [RATING_ROW], error: null });
    let resolveTags!: (v: unknown) => void;
    tagRpc.mockImplementation(() => new Promise((resolve) => { resolveTags = resolve; }));
    mockClient = client;
    const listener = vi.fn();
    const unsubscribe = subscribeStats(listener);

    const pending = fetchStats();
    await vi.advanceTimersByTimeAsync(0);
    expect(getCachedStats().exhibitions.get('ex-1')?.count).toBe(5);
    expect(listener).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect((await pending).tags.size).toBe(0);

    resolveTags({ data: [{ exhibition_id: 'ex-1', tag: '조용함', users: 2 }], error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getCachedStats().tags.get('ex-1')).toEqual([{ tag: '조용함', users: 2 }]);
    expect(getCachedStats().exhibitions.get('ex-1')?.count).toBe(5);
    unsubscribe();
  });

  it('getCachedStats는 상태가 그대로면 같은 참조, 빈 결과끼리는 알리지도 바꾸지도 않는다', async () => {
    const initial = getCachedStats();
    expect(getCachedStats()).toBe(initial);
    expect(initial.tags.size).toBe(0);

    const { client, rpc } = makeMockClient();
    rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    mockClient = client;
    const listener = vi.fn();
    const unsubscribe = subscribeStats(listener);
    await fetchStats();
    // 별점 실패 + 빈 태그 → 바뀐 것이 없다
    expect(getCachedStats()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();

    // 초기화하면 처음 빈 값(같은 모듈 상수)으로 돌아간다
    resetStatsCache();
    expect(getCachedStats()).toBe(initial);
  });

  it('refreshStats는 둘 다 다시 받는다', async () => {
    const { client, rpc, tagRpc } = makeMockClient();
    mockClient = client;
    await fetchStats();
    await refreshStats();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(tagRpc).toHaveBeenCalledTimes(2);
  });
});

describe('shareRating 태그', () => {
  it('정리한 태그만 보낸다 (최대 5개, 잘못된 것은 버림)', async () => {
    const { client, upsert } = makeMockClient();
    mockClient = client;
    await shareRating({ exhibitionId: 'ex-1', venueId: null, stars: 4, minutes: 60, tags: ['#조용함', '조용함', 'Date', '가'.repeat(16), '!!', 'a', 'b', 'c', 'd'] });
    expect((upsert.mock.calls[0][0] as { tags: string[] }).tags).toEqual(['조용함', 'date', 'a', 'b', 'c']);
  });

  it('메모 같은 다른 값은 보내지 않는다', async () => {
    const { client, upsert } = makeMockClient();
    mockClient = client;
    const input = { exhibitionId: 'ex-1', venueId: null, stars: 4, minutes: 60, tags: ['조용함'], note: '비밀 메모' };
    await shareRating(input);
    const sent = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['exhibition_id', 'minutes', 'stars', 'tags', 'venue_id']);
    expect(JSON.stringify(sent)).not.toContain('비밀 메모');
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
        tags: [],
      },
      { onConflict: 'exhibition_id,user_id' },
    );
    const sentRow = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sentRow).sort()).toEqual(['exhibition_id', 'minutes', 'stars', 'tags', 'venue_id']);
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
        tags: [],
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
