import { describe, expect, it, vi } from 'vitest';

// 실제 Supabase를 부르지 않게 서버 함수를 바꿔 둔다 (대기열 테스트는 run을 주입한다)
vi.mock('./sharedRatings', () => ({
  shareRating: vi.fn(),
  deleteMyShared: vi.fn(),
  refreshStats: vi.fn(),
}));

import type { VisitRecord } from '../types/records';
import { deleteMyShared, shareRating, type ShareRatingResult } from './sharedRatings';
import { createShareQueue, DELETE_ALL_KEY, planShareSync, runShareJob, type ShareJob } from './shareSync';

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
