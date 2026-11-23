import { describe, expect, it, vi } from 'vitest';

// 실제 Supabase를 부르지 않게 서버 함수를 바꿔 둔다 (대기열 테스트는 run을 주입한다)
vi.mock('./sharedRatings', () => ({
  shareRating: vi.fn(),
  deleteMyShared: vi.fn(),
  refreshStats: vi.fn(),
}));
// .env.local이 있어도 테스트에서 실제 클라이언트를 만들지 않는다
vi.mock('./supabase', () => ({ supabase: null }));

import type { VisitRecord } from '../types/records';
import { ARCHIVE_KEY, emptyArchive, loadArchive, saveArchive, type ArchiveStorage } from './archive';
import { deleteMyShared, shareRating, type ShareRatingResult } from './sharedRatings';
import {
  BACKFILL_KEY,
  backfillShared,
  clearAndSync,
  createShareQueue,
  DELETE_ALL_KEY,
  planShareSync,
  replanFromRecords,
  runShareJob,
  saveAndSync,
  type ShareJob,
} from './shareSync';

function record(over: Partial<VisitRecord> & Pick<VisitRecord, 'id' | 'exhibitionId'>): VisitRecord {
  return {
    exhibition: {
      title: '전시',
      venueName: '시설',
      venueId: 'venue-a',
      field: '전시/미술',
      imageUrl: null,
      start: '2026-01-01',
      end: '2026-12-31',
    },
    date: '2026-11-01',
    rating: 4,
    visitMinutes: 60,
    note: '',
    shared: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...over,
  };
}

describe('planShareSync', () => {
  it('그 전시에 남은 공유 기록이 없으면 delete', () => {
    expect(planShareSync([], 'ex-1')).toEqual({ type: 'delete', exhibitionId: 'ex-1' });
  });

  it('공유 기록이 여러 건이면 createdAt이 가장 최근인 기록의 값으로 upsert (시설 id는 기록 사본에서)', () => {
    const records = [
      record({ id: 'a', exhibitionId: 'ex-1', rating: 2, visitMinutes: 30, createdAt: '2026-11-01T10:00:00.000Z' }),
      record({
        id: 'b',
        exhibitionId: 'ex-1',
        rating: 5,
        visitMinutes: 120,
        createdAt: '2026-11-03T10:00:00.000Z',
        exhibition: { ...record({ id: 'x', exhibitionId: 'ex-1' }).exhibition, venueId: 'venue-ended' },
      }),
      record({ id: 'c', exhibitionId: 'ex-1', rating: 3, visitMinutes: 45, createdAt: '2026-11-02T10:00:00.000Z' }),
    ];
    expect(planShareSync(records, 'ex-1')).toEqual({
      type: 'upsert',
      payload: { exhibitionId: 'ex-1', venueId: 'venue-ended', stars: 5, minutes: 120 },
    });
  });

  it('createdAt이 같으면 목록에서 앞의 기록을 쓴다', () => {
    const records = [
      record({ id: 'a', exhibitionId: 'ex-1', rating: 1 }),
      record({ id: 'b', exhibitionId: 'ex-1', rating: 5 }),
    ];
    expect(planShareSync(records, 'ex-1')).toMatchObject({ type: 'upsert', payload: { stars: 1 } });
  });

  it('공유 안 된 기록만 있으면 delete (그 값이 최신이어도 올리지 않는다)', () => {
    const records = [
      record({ id: 'a', exhibitionId: 'ex-1', shared: false, createdAt: '2026-11-05T00:00:00.000Z' }),
      record({ id: 'b', exhibitionId: 'ex-1', shared: false }),
    ];
    expect(planShareSync(records, 'ex-1')).toEqual({ type: 'delete', exhibitionId: 'ex-1' });
  });

  it('다른 전시의 공유 기록은 영향을 주지 않는다', () => {
    const records = [
      record({ id: 'a', exhibitionId: 'ex-2', rating: 5, createdAt: '2026-11-09T00:00:00.000Z' }),
      record({ id: 'b', exhibitionId: 'ex-1', rating: 3 }),
    ];
    expect(planShareSync(records, 'ex-1')).toEqual({
      type: 'upsert',
      payload: { exhibitionId: 'ex-1', venueId: 'venue-a', stars: 3, minutes: 60 },
    });
    expect(planShareSync(records.slice(0, 1), 'ex-1')).toEqual({ type: 'delete', exhibitionId: 'ex-1' });
  });
});

const upsert = (exhibitionId: string, stars = 4): ShareJob => ({
  type: 'upsert',
  payload: { exhibitionId, venueId: null, stars, minutes: 60 },
});
const ok: ShareRatingResult = { ok: true };
const fail: ShareRatingResult = { ok: false, reason: 'offline' };

describe('createShareQueue', () => {
  it('실패하면 대기 작업으로 남고, 다시 시도해 성공하면 지우고 onSuccess를 부른다', async () => {
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockResolvedValueOnce(fail).mockResolvedValue(ok);
    const onSuccess = vi.fn();
    const q = createShareQueue({ run, onSuccess });

    q.submit({ type: 'delete', exhibitionId: 'ex-1' });
    await q.idle();
    expect(q.getSnapshot()).toEqual({ pendingCount: 1, busy: false });
    expect(onSuccess).not.toHaveBeenCalled();

    q.retryAll();
    await q.idle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(q.getSnapshot().pendingCount).toBe(0);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('같은 전시에 새 작업이 오면 대기 작업을 덮어쓴다', async () => {
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockResolvedValue(fail);
    const q = createShareQueue({ run });

    q.submit(upsert('ex-1'));
    await q.idle();
    q.submit({ type: 'delete', exhibitionId: 'ex-1' });
    q.submit(upsert('ex-2'));
    await q.idle();
    expect(q.getSnapshot().pendingCount).toBe(2);

    run.mockClear();
    run.mockResolvedValue(ok);
    q.retryAll();
    await q.idle();
    expect(run.mock.calls.map(([job]) => job)).toEqual([{ type: 'delete', exhibitionId: 'ex-1' }, upsert('ex-2')]);
  });

  it('아직 보내지 않은 작업은 더 새 작업이 오면 건너뛴다', async () => {
    let release!: () => void;
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve(ok); }),
    ).mockResolvedValue(ok);
    const q = createShareQueue({ run });

    q.submit(upsert('ex-0'));
    q.submit(upsert('ex-1', 2));
    q.submit({ type: 'delete', exhibitionId: 'ex-1' });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(q.getSnapshot().busy).toBe(true);
    release();
    await q.idle();
    expect(run.mock.calls.map(([job]) => job)).toEqual([upsert('ex-0'), { type: 'delete', exhibitionId: 'ex-1' }]);
  });

  it("'disabled'(환경변수 없음)면 대기 작업을 만들지 않는다", async () => {
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockResolvedValue({ ok: false, reason: 'disabled' });
    const q = createShareQueue({ run });
    q.submit(upsert('ex-1'));
    q.submit({ type: 'deleteAll' });
    await q.idle();
    expect(q.getSnapshot().pendingCount).toBe(0);
  });

  it('전체 삭제는 앞선 대기 작업을 버리고, 실패하면 전체 삭제 하나만 남는다', async () => {
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockResolvedValue(fail);
    const q = createShareQueue({ run });
    q.submit(upsert('ex-1'));
    await q.idle();
    q.submit({ type: 'deleteAll' });
    await q.idle();
    expect(q.getSnapshot().pendingCount).toBe(1);

    run.mockClear();
    run.mockResolvedValue(ok);
    q.retryAll();
    await q.idle();
    expect(run.mock.calls.map(([job]) => job)).toEqual([{ type: 'deleteAll' }]);
  });

  it('전체 삭제가 대기 중일 때 새로 공유한 기록은 전체 삭제를 다시 시도해 성공한 뒤 다시 올린다', async () => {
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>()
      .mockResolvedValueOnce(fail) // 전체 삭제 실패
      .mockResolvedValue(ok);
    const q = createShareQueue({ run });
    q.submit({ type: 'deleteAll' });
    await q.idle();
    q.submit(upsert('ex-9', 5));
    await q.idle();
    expect(q.getSnapshot().pendingCount).toBe(1);

    run.mockClear();
    q.retryAll();
    await q.idle();
    expect(run.mock.calls.map(([job]) => job)).toEqual([{ type: 'deleteAll' }, upsert('ex-9', 5)]);
    expect(q.getSnapshot().pendingCount).toBe(0);
  });

  it('run이 예외를 던져도 대기 작업으로 남는다', async () => {
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockRejectedValue(new Error('boom'));
    const q = createShareQueue({ run });
    q.submit({ type: 'delete', exhibitionId: 'ex-1' });
    await q.idle();
    expect(q.getSnapshot()).toEqual({ pendingCount: 1, busy: false });
  });
});

describe('runShareJob', () => {
  it("삭제의 'no_session'(공유한 적 없는 브라우저)은 성공으로 본다", async () => {
    vi.mocked(deleteMyShared).mockResolvedValue({ ok: false, reason: 'no_session' });
    expect(await runShareJob({ type: 'delete', exhibitionId: 'ex-1' })).toEqual({ ok: true });
    expect(await runShareJob({ type: 'deleteAll' })).toEqual({ ok: true });
    expect(vi.mocked(deleteMyShared).mock.calls).toEqual([['ex-1'], [undefined]]);
  });

  it('삭제의 다른 실패와 disabled는 그대로 돌려준다', async () => {
    vi.mocked(deleteMyShared).mockResolvedValueOnce({ ok: false, reason: 'delete_failed' }).mockResolvedValueOnce({ ok: false, reason: 'disabled' });
    expect(await runShareJob({ type: 'delete', exhibitionId: 'ex-1' })).toEqual({ ok: false, reason: 'delete_failed' });
    expect(await runShareJob({ type: 'deleteAll' })).toEqual({ ok: false, reason: 'disabled' });
  });

  it('upsert는 shareRating 결과를 그대로 돌려준다', async () => {
    vi.mocked(shareRating).mockResolvedValue({ ok: false, reason: 'no_session' });
    expect(await runShareJob(upsert('ex-1'))).toEqual({ ok: false, reason: 'no_session' });
    expect(shareRating).toHaveBeenCalledWith({ exhibitionId: 'ex-1', venueId: null, stars: 4, minutes: 60 });
  });

  it('전체 삭제 키 이름', () => {
    expect(DELETE_ALL_KEY).toBe('전체 삭제');
  });
});

// ─── 저장소와 함께 쓰는 흐름 ────────────────────────────────

/** 메모리 저장소. fail* 옵션으로 저장소 오류를 흉내 낸다 */
function memoryStorage(opts: { failSet?: boolean; failRemove?: boolean; failGet?: boolean } = {}) {
  const map = new Map<string, string>();
  const storage: ArchiveStorage = {
    getItem: (k) => {
      if (opts.failGet) throw new Error('blocked');
      return map.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (opts.failSet) throw new Error('quota');
      map.set(k, v);
    },
    removeItem: (k) => {
      if (opts.failRemove) throw new Error('blocked');
      map.delete(k);
    },
  };
  return { storage, map };
}

const withRecords = (records: VisitRecord[]) => ({ ...emptyArchive(), records });
const fakeQueue = () => ({ submit: vi.fn<(job: ShareJob) => void>() });

describe('saveAndSync / clearAndSync', () => {
  it('저장에 실패하면 서버 작업을 보내지 않고 false', () => {
    const { storage } = memoryStorage({ failSet: true });
    const queue = fakeQueue();
    expect(saveAndSync(storage, withRecords([record({ id: 'r1', exhibitionId: 'ex-1' })]), ['ex-1'], queue)).toBe(false);
    expect(queue.submit).not.toHaveBeenCalled();
  });

  it('저장에 성공하면 전시마다(중복 없이) planShareSync 결과를 보낸다', () => {
    const { storage } = memoryStorage();
    const queue = fakeQueue();
    const next = withRecords([record({ id: 'r1', exhibitionId: 'ex-1', rating: 5 })]);
    expect(saveAndSync(storage, next, ['ex-1', 'ex-2', 'ex-1'], queue)).toBe(true);
    expect(queue.submit.mock.calls.map(([job]) => job)).toEqual([planShareSync(next.records, 'ex-1'), { type: 'delete', exhibitionId: 'ex-2' }]);
  });

  it('전시 id가 없으면(관심 분야 변경 등) 저장만 한다', () => {
    const { storage, map } = memoryStorage();
    const queue = fakeQueue();
    expect(saveAndSync(storage, { ...emptyArchive(), interests: ['전시/미술'] }, [], queue)).toBe(true);
    expect(map.has(ARCHIVE_KEY)).toBe(true);
    expect(queue.submit).not.toHaveBeenCalled();
  });

  it('전체 삭제: 저장소에서 지우지 못하면 서버를 부르지 않고 false, 지웠으면 deleteAll', () => {
    const queue = fakeQueue();
    expect(clearAndSync(memoryStorage({ failRemove: true }).storage, queue)).toBe(false);
    expect(queue.submit).not.toHaveBeenCalled();

    const { storage, map } = memoryStorage();
    saveArchive(storage, withRecords([record({ id: 'r1', exhibitionId: 'ex-1' })]));
    map.set(BACKFILL_KEY, '2026-11-23T00:00:00.000Z');
    expect(clearAndSync(storage, queue)).toBe(true);
    expect(queue.submit.mock.calls).toEqual([[{ type: 'deleteAll' }]]);
    expect(map.has(ARCHIVE_KEY)).toBe(false);
    // 예전 공유 기록 올리기 표시는 전체 삭제에서도 남긴다
    expect(map.get(BACKFILL_KEY)).toBe('2026-11-23T00:00:00.000Z');
  });
});

describe('backfillShared', () => {
  const now = new Date('2026-11-23T01:02:03.000Z');
  const records = [
    record({ id: 'r1', exhibitionId: 'ex-1', rating: 3, createdAt: '2026-11-01T10:00:00.000Z' }),
    record({ id: 'r2', exhibitionId: 'ex-1', rating: 5, createdAt: '2026-11-02T10:00:00.000Z' }),
    record({ id: 'r3', exhibitionId: 'ex-2', shared: false }),
    record({ id: 'r4', exhibitionId: 'ex-3', rating: 2 }),
  ];

  it('처음 열 때 공유 기록이 있는 전시마다 upsert를 한 번 보내고 실행 시각을 남긴다. 두 번째에는 보내지 않는다', () => {
    const { storage, map } = memoryStorage();
    const queue = fakeQueue();
    expect(backfillShared(storage, records, { enabled: true, queue, now })).toBe(2);
    expect(queue.submit.mock.calls.map(([job]) => job)).toEqual([planShareSync(records, 'ex-1'), planShareSync(records, 'ex-3')]);
    expect(queue.submit.mock.calls.every(([job]) => job.type === 'upsert')).toBe(true);
    expect(map.get(BACKFILL_KEY)).toBe(now.toISOString());

    queue.submit.mockClear();
    expect(backfillShared(storage, records, { enabled: true, queue, now })).toBe(0);
    expect(queue.submit).not.toHaveBeenCalled();
  });

  it('클라이언트가 없으면 하지 않고 표시도 남기지 않는다 (기본값은 supabase 모듈 기준)', () => {
    const { storage, map } = memoryStorage();
    const queue = fakeQueue();
    expect(backfillShared(storage, records, { enabled: false, queue, now })).toBe(0);
    expect(backfillShared(storage, records, { queue, now })).toBe(0);
    expect(queue.submit).not.toHaveBeenCalled();
    expect(map.has(BACKFILL_KEY)).toBe(false);
  });

  it('공유 기록이 없으면 아무것도 보내지 않아 익명 로그인도 하지 않는다', async () => {
    vi.mocked(shareRating).mockClear();
    const { storage, map } = memoryStorage();
    const q = createShareQueue({ run: runShareJob });
    expect(backfillShared(storage, [record({ id: 'r1', exhibitionId: 'ex-1', shared: false })], { enabled: true, queue: q, now })).toBe(0);
    await q.idle();
    expect(shareRating).not.toHaveBeenCalled();
    expect(map.get(BACKFILL_KEY)).toBe(now.toISOString());
  });

  it('표시를 읽거나 남길 수 없으면 하지 않는다 (열 때마다 다시 올리지 않게)', () => {
    const queue = fakeQueue();
    expect(backfillShared(memoryStorage({ failSet: true }).storage, records, { enabled: true, queue, now })).toBe(0);
    expect(backfillShared(memoryStorage({ failGet: true }).storage, records, { enabled: true, queue, now })).toBe(0);
    expect(queue.submit).not.toHaveBeenCalled();
  });

  it('실패한 항목은 대기열에 남아 다시 시도를 기다린다', async () => {
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockResolvedValueOnce(fail).mockResolvedValue(ok);
    const q = createShareQueue({ run });
    backfillShared(memoryStorage().storage, records, { enabled: true, queue: q, now });
    await q.idle();
    expect(q.getSnapshot().pendingCount).toBe(1);
  });
});

describe('replanFromRecords', () => {
  it('전시 키는 지금 기록으로 다시 계산한다', () => {
    const records = [record({ id: 'r1', exhibitionId: 'ex-1', rating: 2 })];
    expect(replanFromRecords(records, ['ex-1', 'ex-2'])).toEqual([planShareSync(records, 'ex-1'), { type: 'delete', exhibitionId: 'ex-2' }]);
  });

  it('전체 삭제: 기록이 비어 있으면 전체 삭제만, 새 공유 기록이 있으면 전체 삭제 뒤 전시별로 다시 올린다', () => {
    expect(replanFromRecords([], [DELETE_ALL_KEY])).toEqual([{ type: 'deleteAll' }]);
    const records = [record({ id: 'r1', exhibitionId: 'ex-9', rating: 5 }), record({ id: 'r2', exhibitionId: 'ex-8', shared: false })];
    expect(replanFromRecords(records, [DELETE_ALL_KEY, 'ex-9'])).toEqual([{ type: 'deleteAll' }, planShareSync(records, 'ex-9')]);
  });
});

describe('다시 시도 시 저장소의 지금 기록으로 다시 계산', () => {
  // 화면의 shareQueue와 같은 방식: 다시 시도할 때 저장소를 다시 읽는다
  function queueOn(storage: ArchiveStorage, run: (job: ShareJob) => Promise<ShareRatingResult>) {
    return createShareQueue({ run, replan: (keys) => replanFromRecords(loadArchive(storage, () => undefined).data.records, keys) });
  }

  it('다른 탭에서 공유를 철회한 전시는 예전 upsert 대신 delete를 보낸다', async () => {
    const { storage } = memoryStorage();
    const shared = withRecords([record({ id: 'r1', exhibitionId: 'ex-1', rating: 4 })]);
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockResolvedValueOnce(fail).mockResolvedValue(ok);
    const q = queueOn(storage, run);
    expect(saveAndSync(storage, shared, ['ex-1'], q)).toBe(true);
    await q.idle();
    expect(q.getSnapshot().pendingCount).toBe(1);

    // 다른 탭: 같은 기록을 비공개로 바꿔 저장
    saveArchive(storage, withRecords([{ ...shared.records[0], shared: false }]));

    run.mockClear();
    q.retryAll();
    await q.idle();
    expect(run.mock.calls.map(([job]) => job)).toEqual([{ type: 'delete', exhibitionId: 'ex-1' }]);
    expect(q.getSnapshot().pendingCount).toBe(0);
  });

  it('다른 탭에서 별점을 바꿨으면 새 값으로 올린다', async () => {
    const { storage } = memoryStorage();
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockResolvedValueOnce(fail).mockResolvedValue(ok);
    const q = queueOn(storage, run);
    saveAndSync(storage, withRecords([record({ id: 'r1', exhibitionId: 'ex-1', rating: 4 })]), ['ex-1'], q);
    await q.idle();
    saveArchive(storage, withRecords([record({ id: 'r1', exhibitionId: 'ex-1', rating: 1 })]));

    run.mockClear();
    q.retryAll();
    await q.idle();
    expect(run.mock.calls.map(([job]) => job)).toEqual([
      { type: 'upsert', payload: { exhibitionId: 'ex-1', venueId: 'venue-a', stars: 1, minutes: 60 } },
    ]);
  });

  it('전체 삭제 대기 중: 저장소가 비어 있으면 전체 삭제만 다시 보낸다', async () => {
    const { storage } = memoryStorage();
    saveArchive(storage, withRecords([record({ id: 'r1', exhibitionId: 'ex-1' })]));
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockResolvedValueOnce(fail).mockResolvedValue(ok);
    const q = queueOn(storage, run);
    expect(clearAndSync(storage, q)).toBe(true);
    await q.idle();
    expect(q.getSnapshot().pendingCount).toBe(1);

    run.mockClear();
    q.retryAll();
    await q.idle();
    expect(run.mock.calls.map(([job]) => job)).toEqual([{ type: 'deleteAll' }]);
    expect(q.getSnapshot().pendingCount).toBe(0);
  });

  it('전체 삭제 대기 중 다른 탭에서 새 기록이 생기면 전시별로 다시 계산해 보낸다 (공유 기록은 전체 삭제 뒤 upsert)', async () => {
    const { storage } = memoryStorage();
    saveArchive(storage, withRecords([record({ id: 'r1', exhibitionId: 'ex-1' })]));
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockResolvedValueOnce(fail).mockResolvedValue(ok);
    const q = queueOn(storage, run);
    clearAndSync(storage, q);
    await q.idle();

    // 다른 탭: 전체 삭제 뒤 새 기록 두 개 (하나만 공유)
    saveArchive(storage, withRecords([
      record({ id: 'n1', exhibitionId: 'ex-7', rating: 5 }),
      record({ id: 'n2', exhibitionId: 'ex-8', shared: false }),
    ]));

    run.mockClear();
    q.retryAll();
    await q.idle();
    expect(run.mock.calls.map(([job]) => job)).toEqual([
      { type: 'deleteAll' },
      { type: 'upsert', payload: { exhibitionId: 'ex-7', venueId: 'venue-a', stars: 5, minutes: 60 } },
    ]);
    expect(q.getSnapshot().pendingCount).toBe(0);
  });

  it('여러 대기 작업이 있으면 전체 삭제를 먼저, 나머지 전시도 지금 기록으로 보낸다', async () => {
    const { storage } = memoryStorage();
    const run = vi.fn<(job: ShareJob) => Promise<ShareRatingResult>>().mockResolvedValue(fail);
    const q = queueOn(storage, run);
    clearAndSync(storage, q);
    await q.idle();
    // 전체 삭제가 실패한 뒤 이 탭에서 새로 공유 (이것도 실패)
    saveAndSync(storage, withRecords([record({ id: 'n1', exhibitionId: 'ex-5', rating: 3 })]), ['ex-5'], q);
    await q.idle();
    expect(q.getSnapshot().pendingCount).toBe(2);

    run.mockClear();
    run.mockResolvedValue(ok);
    q.retryAll();
    await q.idle();
    expect(run.mock.calls.map(([job]) => job)).toEqual([
      { type: 'deleteAll' },
      { type: 'upsert', payload: { exhibitionId: 'ex-5', venueId: 'venue-a', stars: 3, minutes: 60 } },
    ]);
    expect(q.getSnapshot().pendingCount).toBe(0);
  });
});
