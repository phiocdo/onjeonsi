/**
 * 아카이브 기록의 익명 공유 상태를 서버(shared_ratings)에 맞추는 일.
 *
 * - planShareSync: 기록 목록이 바뀐 뒤 한 전시에 대해 서버에 무엇을 해야 하는지 정하는 순수 함수.
 *   서버에는 (전시, 사용자)마다 한 행만 있으므로, 그 전시에 공유 중인 기록이 여러 건이면 가장 최근 기록의 값을 올린다.
 * - createShareQueue: 서버 작업을 한 줄로 차례대로 보내고, 실패한 작업을 다시 시도할 수 있게 들고 있는 대기열.
 *   공유 철회(delete)가 조용히 실패하면 사용자는 철회했다고 믿는데 서버에는 남으므로, 실패는 반드시 대기 작업으로 남긴다.
 *
 * 한계: 대기 작업은 메모리에만 둔다. 새로고침하거나 탭을 닫으면 사라지고, 다시 시도 안내도 없어진다.
 * (localStorage에 남기면 기록 저장 형식과 별개로 관리할 것이 늘어나 이번 범위에서는 하지 않았다.)
 */
import type { VisitRecord } from '../types/records';
import {
  deleteMyShared,
  refreshStats,
  shareRating,
  type ShareRatingInput,
  type ShareRatingResult,
} from './sharedRatings';

export type ShareAction =
  | { type: 'upsert'; payload: ShareRatingInput }
  | { type: 'delete'; exhibitionId: string };

/** 대기열 작업. deleteAll은 아카이브 전체 삭제 때 내 공유 행 전부를 지우는 작업 */
export type ShareJob = ShareAction | { type: 'deleteAll' };

/** 전체 삭제 작업의 대기열 키 */
export const DELETE_ALL_KEY = '전체 삭제';

/**
 * 바뀐 뒤의 기록 목록(nextRecords)을 보고 한 전시의 서버 작업을 정한다.
 * 그 전시에 공유 중인 기록이 있으면 가장 최근 기록(createdAt 기준, 같으면 목록에서 앞의 것)의 값으로 upsert,
 * 없으면 delete. 시설 id는 기록할 때 복사해 둔 record.exhibition.venueId를 쓴다(끝난 전시도 유지).
 */
export function planShareSync(nextRecords: readonly VisitRecord[], exhibitionId: string): ShareAction {
  let latest: VisitRecord | undefined;
  for (const r of nextRecords) {
    if (r.exhibitionId !== exhibitionId || !r.shared) continue;
    if (!latest || r.createdAt > latest.createdAt) latest = r;
  }
  if (!latest) return { type: 'delete', exhibitionId };
  return {
    type: 'upsert',
    payload: {
      exhibitionId: latest.exhibitionId,
      venueId: latest.exhibition.venueId,
      stars: latest.rating,
      minutes: latest.visitMinutes,
    },
  };
}

export function jobKey(job: ShareJob): string {
  if (job.type === 'deleteAll') return DELETE_ALL_KEY;
  return job.type === 'upsert' ? job.payload.exhibitionId : job.exhibitionId;
}

/**
 * 작업 하나를 서버에 보낸다.
 * 삭제에서 'no_session'은 이 브라우저가 공유한 적이 없어 지울 행이 없다는 뜻이므로 성공으로 본다.
 */
export async function runShareJob(job: ShareJob): Promise<ShareRatingResult> {
  const res =
    job.type === 'upsert'
      ? await shareRating(job.payload)
      : await deleteMyShared(job.type === 'delete' ? job.exhibitionId : undefined);
  if (!res.ok && job.type !== 'upsert' && res.reason === 'no_session') return { ok: true };
  return res;
}

export interface ShareQueueSnapshot {
  // 실패해서 다시 시도를 기다리는 작업 수
  pendingCount: number;
  // 보내는 중이거나 보낼 차례를 기다리는 작업이 있음
  busy: boolean;
}

export interface ShareQueue {
  /** 새 작업. 같은 전시의 대기 작업은 덮어쓴다. deleteAll이면 앞선 전시별 작업은 모두 버린다 */
  submit(job: ShareJob): void;
  /** 대기 작업을 모두 다시 보낸다 */
  retryAll(): void;
  getSnapshot(): ShareQueueSnapshot;
  subscribe(listener: () => void): () => void;
  /** 대기열이 빌 때까지 기다린다 (테스트용) */
  idle(): Promise<void>;
}

export interface ShareQueueOptions {
  run?: (job: ShareJob) => Promise<ShareRatingResult>;
  // 작업이 서버에 반영되면 호출 (공유 통계 다시 읽기)
  onSuccess?: () => void;
}

/**
 * 서버 작업 대기열. 작업은 한 줄로 차례대로 보내므로 늦게 누른 철회가 먼저 반영된 뒤
 * 앞선 공유가 덮어쓰는 일이 없다.
 */
export function createShareQueue({ run = runShareJob, onSuccess }: ShareQueueOptions = {}): ShareQueue {
  // 키마다 가장 최근에 맡긴 작업. 차례가 왔을 때 이것과 다르면 더 새 작업이 있으니 건너뛴다
  const latest = new Map<string, ShareJob>();
  // 실패해서 다시 시도를 기다리는 작업 (키마다 하나)
  const pending = new Map<string, ShareJob>();
  // 전체 삭제가 서버에 반영되기 전에 맡긴 전시별 작업. 전체 삭제가 (다시 시도로) 성공하면 공유를 다시 올린다
  const sinceDeleteAll = new Map<string, ShareJob>();
  // 서버에 한 번이라도 보낸 작업
  const ran = new WeakSet<ShareJob>();
  const listeners = new Set<() => void>();
  let chain: Promise<void> = Promise.resolve();
  let queued = 0;
  let snapshot: ShareQueueSnapshot = { pendingCount: 0, busy: false };

  function emit() {
    const next = { pendingCount: pending.size, busy: queued > 0 };
    if (next.pendingCount === snapshot.pendingCount && next.busy === snapshot.busy) return;
    snapshot = next;
    listeners.forEach((fn) => fn());
  }

  async function execute(job: ShareJob) {
    const key = jobKey(job);
    if (latest.get(key) !== job) return;

    let res: ShareRatingResult;
    try {
      res = await run(job);
    } catch (err) {
      res = { ok: false, reason: err instanceof Error ? err.message : 'unknown' };
    }
    ran.add(job);
    // 기다리는 동안 더 새 작업이 들어왔으면 그 작업이 결과를 정한다
    if (latest.get(key) !== job) return;

    if (res.ok) {
      pending.delete(key);
      if (job.type === 'deleteAll') {
        latest.delete(DELETE_ALL_KEY);
        // 전체 삭제가 늦게 반영되어 그 사이에 올린 공유까지 지웠을 수 있으니 다시 올린다
        // (아직 차례를 기다리는 작업은 어차피 이 뒤에 보내지므로 이미 보낸 것만)
        const again = [...sinceDeleteAll.values()].filter((j) => j.type === 'upsert' && ran.has(j) && latest.get(jobKey(j)) === j);
        sinceDeleteAll.clear();
        again.forEach(enqueue);
      }
      onSuccess?.();
    } else if (res.reason !== 'disabled') {
      // 환경변수가 없어 서버를 쓰지 않는 경우(disabled)는 다시 시도할 것이 없다
      pending.set(key, job);
    }
  }

  function enqueue(job: ShareJob) {
    queued += 1;
    emit();
    chain = chain
      .then(() => execute(job))
      .finally(() => {
        queued -= 1;
        emit();
      });
  }

  return {
    submit(job) {
      const key = jobKey(job);
      if (job.type === 'deleteAll') {
        latest.clear();
        pending.clear();
        sinceDeleteAll.clear();
      } else {
        pending.delete(key);
        // 전체 삭제가 아직 서버에 반영되지 않았으면(보내는 중이거나 실패해 대기 중) 기억해 둔다
        if (latest.has(DELETE_ALL_KEY)) sinceDeleteAll.set(key, job);
      }
      latest.set(key, job);
      enqueue(job);
    },
    retryAll() {
      // 전체 삭제를 먼저 보낸다 (Map은 넣은 순서를 지키고, 전체 삭제는 대기열을 비운 뒤 들어가므로 맨 앞에 있다)
      for (const job of pending.values()) enqueue(job);
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async idle() {
      // 기다리는 동안 뒤에 붙은 작업(전체 삭제 뒤 다시 올리기 등)까지 기다린다
      let current: Promise<void>;
      do {
        current = chain;
        await current;
      } while (current !== chain);
    },
  };
}

/**
 * 화면에서 쓰는 대기열 하나. 페이지를 옮겨 다녀도(아카이브 화면이 다시 그려져도) 대기 작업이 유지되도록 모듈에 둔다.
 * 새로고침하면 사라진다(맨 위 주석의 한계 참고).
 */
export const shareQueue = createShareQueue({
  onSuccess: () => {
    void refreshStats();
  },
});
