/**
 * 정적 시드 기록(data/reviews/seed.json)을 집계용 기록 형식으로 바꾼 것.
 * 전시 상세 창(OneExhibit.tsx)과 아카이브 추천(Archive.tsx)이 같은 값을 쓴다.
 */
import seedJson from '../../data/reviews/seed.json';
import { fromSeedReview, type RatingRecord, type SeedReviewInput } from './ratings';

export const SEED_RECORDS: readonly RatingRecord[] = (seedJson as SeedReviewInput[]).map(fromSeedReview);
