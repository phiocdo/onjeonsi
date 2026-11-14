import type { JudgeInput } from '../types';
import type { JudgeFn } from './judge';
import { toMinutes, fromMinutes } from './time';
import { DEFAULT_VISIT_MINUTES } from './constants';

const STEP_MINUTES = 30;

export interface StartCandidates {
  /** 관람 가능한 입장 시각(최대 limit개). */
  possible: string[];
  /** 불가 구간. range는 'HH:MM'(한 시각) 또는 'HH:MM~HH:MM'(같은 사유가 이어진 출발 시각 범위). */
  unavailable: { range: string; reason: string }[];
  /** 정보 부족으로 '확인 필요'인 출발 시각. */
  unknown: string[];
}

/**
 * 머무는 구간(ranges)마다 30분 간격 출발 시각을 만들어 judge에 묻고 결과를 모은다.
 * 운영시간·휴관 판단은 전부 judge에 맡긴다.
 * - 시작 시각은 range.start를 30분 단위로 올림한다 (10:10 → 10:30).
 * - 후보 + 관람 소요 시간 <= range.end 인 동안만 묻는다.
 */
export function findStartCandidates(
  input: Omit<JudgeInput, 'stayStart' | 'stayEnd'>,
  ranges: { start: string; end: string }[],
  judge: JudgeFn,
  limit = 3,
): StartCandidates {
  const visit = input.venue.visitMinutes || DEFAULT_VISIT_MINUTES;
  const possible: string[] = [];
  const unavailable: StartCandidates['unavailable'] = [];
  const unknown: string[] = [];

  for (const range of ranges) {
    const start = toMinutes(range.start);
    const end = toMinutes(range.end);
    if (start === null || end === null) continue;

    // 같은 range 안에서 같은 사유가 연속되면 한 구간으로 묶는다.
    // (클로저 안에서 바꾸는 값이라 TS 좁히기가 꼬이지 않도록 객체에 담는다.)
    const pending: { run: { from: string; to: string; reason: string } | null } = { run: null };
    const flush = () => {
      const { run } = pending;
      if (!run) return;
      const label = run.from === run.to ? run.from : `${run.from}~${run.to}`;
      unavailable.push({ range: label, reason: run.reason });
      pending.run = null;
    };

    for (let t = Math.ceil(start / STEP_MINUTES) * STEP_MINUTES; t + visit <= end; t += STEP_MINUTES) {
      const at = fromMinutes(t);
      const res = judge({ ...input, stayStart: at, stayEnd: range.end });

      if (res.result === 'impossible') {
        const reason = res.reasons.join(', ');
        if (pending.run && pending.run.reason === reason) {
          pending.run.to = at;
        } else {
          flush();
          pending.run = { from: at, to: at, reason };
        }
        continue;
      }

      flush();
      if (res.result === 'possible') {
        // 개관 전 출발은 judge가 개관 시각으로 당겨 주므로 실제 입장 시각 기준으로 중복을 없앤다.
        const entry = res.entryTime ?? at;
        if (possible.length < limit && !possible.includes(entry)) possible.push(entry);
      } else if (!unknown.includes(at)) {
        unknown.push(at);
      }
    }
    flush();
  }

  return { possible, unavailable, unknown };
}
