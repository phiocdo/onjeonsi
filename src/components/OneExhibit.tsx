import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { basisLabel, displayLocation, displayVenueName, getCatalog, getHolidays, judgeEntry, todayInSeoul, type CatalogEntry } from '../lib/catalog'
import { getRatingSummary } from '../lib/ratings'
import { SEED_RECORDS } from '../lib/seed'
import { getCachedStats, subscribeStats } from '../lib/sharedRatings'
import { similarExhibitions } from '../lib/similar'
import { sharedTags, tagsOf } from '../lib/tags'
import type { JudgeResult, Venue, Weekday } from '../types'
import './OneExhibit.css'

export type Status = '가능' | '불가' | '확인 필요'
type Pick = { id: string; judge?: JudgeResult }
type Listener = (pick: Pick | null) => void
type Props = { id: string; title: string; venue: string; status: Status; judge?: JudgeResult; poster?: string; lines?: string[] }
type Detail = {
  title: string; venue: string; eyebrow: string; poster?: string; period: string; hours: string; closed: string; lastEntry: string
  entry: string; reservation: string; duration: string; status: Status; reason: string; source: string; checked: string
  official?: string; portal?: string; mapUrl: string; hasCoord: boolean
}

const EMPTY = '정보 없음'
const ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY: Record<Weekday, string> = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' }
const STATUS: Record<JudgeResult['result'], Status> = { possible: '가능', impossible: '불가', unknown: '확인 필요' }
const TAG: Record<Status, string> = { 가능: 'possible', 불가: 'impossible', '확인 필요': 'unknown' }
const LISTENERS = new Set<Listener>()
const BAR: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }
let CURRENT: Pick | null = null

// 상세 창 열기
export function OPEN(id: string, judge?: JudgeResult) {
  CURRENT = { id, judge }
  LISTENERS.forEach((fn) => fn(CURRENT))
}

// 상세 창 닫기
export function CLOSE() {
  CURRENT = null
  LISTENERS.forEach((fn) => fn(CURRENT))
}

// 서울 현재 날짜와 시각 조회
function NOW() {
  const now = new Date()
  return { date: todayInSeoul(now), time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) }
}

// 요일별 운영 시간 문자열 변환
function HOURS(venue: Venue | null, fallback?: string): string {
  if (!venue?.hours) return fallback || EMPTY
  const list = ORDER.filter((d) => venue.hours?.[d]).map((d) => `${DAY[d]} ${venue.hours![d]!.open}~${venue.hours![d]!.close}`)
  return list.length ? list.join(' · ') : fallback || EMPTY
}

// 휴관 규칙 문자열 변환
function CLOSED(venue: Venue | null): string {
  const c = venue?.closed
  if (!c) return EMPTY
  const parts: string[] = []
  if (c.weekday) parts.push(`매주 ${DAY[c.weekday]}요일`)
  if (c.ifHoliday === 'nextDay') parts.push('공휴일 다음 날')
  if (c.dates?.length) parts.push(c.dates.join(', '))
  return parts.length ? parts.join(' · ') : EMPTY
}

// 전시 상세 정보 조립
function DETAIL(entry: CatalogEntry, passed?: JudgeResult): Detail {
  const { exhibition: ex, venue } = entry
  const placeName = displayVenueName(entry) || EMPTY
  const loc = displayLocation(entry)
  const pos = loc && loc.lat !== 0 && loc.lng !== 0 ? loc : null
  const { date, time } = NOW()
  const judge = passed ?? judgeEntry(entry, { date, stayStart: time, stayEnd: '23:59' }, getHolidays())
  const basis = basisLabel(judge.basis)
  const target = venue?.name ?? placeName

  return {
    title: ex.title, venue: placeName, eyebrow: venue ? `${venue.name} · ${venue.gu} · ${venue.type}` : placeName, poster: ex.imageUrl || undefined,
    period: `${ex.start} ~ ${ex.end}`, hours: HOURS(venue, ex.hoursText), closed: CLOSED(venue), lastEntry: venue?.lastEntry ?? EMPTY,
    entry: venue?.entry ?? EMPTY, reservation: venue?.reservation ?? EMPTY, duration: venue?.visitMinutes ? `${venue.visitMinutes}분` : EMPTY,
    status: STATUS[judge.result], reason: [judge.reasons.join(' '), basis].filter(Boolean).join(' · '),
    source: venue ? `${venue.source} · 서울 열린데이터광장` : '서울 열린데이터광장',
    checked: venue?.verified ?? EMPTY, official: ex.link && ex.link.startsWith('http') ? ex.link : undefined,
    portal: ex.detailUrl && ex.detailUrl.startsWith('http') ? ex.detailUrl : undefined,
    mapUrl: pos ? `https://map.kakao.com/link/map/${encodeURIComponent(target)},${pos.lat},${pos.lng}` : `https://map.kakao.com/link/search/${encodeURIComponent(target)}`,
    hasCoord: pos !== null
  }
}

type Similar = { id: string; title: string; venue: string; poster?: string; tags: string; judge: JudgeResult; status: Status }

// 비슷한 전시 카드 조립. 판정은 고른 카드에 대해서만 오늘 지금 기준으로 계산한다
function SIMILAR(id: string | undefined): Similar[] {
  if (!id) return []
  const catalog = getCatalog()
  const target = catalog.find((item) => item.exhibition.id === id)
  if (!target) return []
  const { date, time } = NOW()
  const mine = tagsOf(target)
  return similarExhibitions(target, catalog, { today: date }).map((entry) => {
    const judge = judgeEntry(entry, { date, stayStart: time, stayEnd: '23:59' }, getHolidays())
    const common = sharedTags(mine, tagsOf(entry)).slice(0, 2)
    return {
      id: entry.exhibition.id, title: entry.exhibition.title, venue: displayVenueName(entry) || EMPTY,
      poster: entry.exhibition.imageUrl || undefined, tags: common.length ? common.join(' · ') : '같은 장소',
      judge, status: STATUS[judge.result]
    }
  })
}

// 전시 상세 창
export function WINDOW() {
  const [pick, setPick] = useState<Pick | null>(CURRENT)
  const stats = useSyncExternalStore(subscribeStats, getCachedStats)
  // 상세 창이 열리거나 다른 전시로 바뀔 때만 다시 계산
  const similar = useMemo(() => SIMILAR(pick?.id), [pick])

  useEffect(() => {
    LISTENERS.add(setPick)
    return () => { LISTENERS.delete(setPick) }
  }, [])

  useEffect(() => {
    if (!pick) return
    const prev = document.body.style.overflow
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') CLOSE() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', key)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', key) }
  }, [pick])

  if (!pick) return null
  const found = getCatalog().find((item) => item.exhibition.id === pick.id)
  const detail = found ? DETAIL(found, pick.judge) : null
  const rating = found
    ? getRatingSummary(found.exhibition.id, found.venue?.id ?? null, { stats, seed: SEED_RECORDS })
    : null

  return (
    <div className="one-backdrop" role="dialog" aria-modal="true" onClick={CLOSE}>
      <div className="one-window" onClick={(e) => e.stopPropagation()}>
        <div className="one-bar" style={BAR}>
          <span className="one-bar-title">{detail ? detail.venue : '전시 상세'}</span>
          <button type="button" className="one-close" aria-label="닫기" onClick={CLOSE}>✕</button>
        </div>

        <div className="one-body">
          {!detail ? (
            <p className="empty-result">전시를 찾을 수 없어요.</p>
          ) : (
            <div className="one-layout">
              <div className="one-poster-box">
                {detail.poster ? <img src={detail.poster} alt={detail.title} decoding="async" /> : <div className="poster-empty">포스터 없음</div>}
              </div>

              <div className="one-content">
                <div className="one-head" style={BAR}>
                  <div>
                    <p className="eyebrow">{detail.eyebrow}</p>
                    <h2>{detail.title}</h2>
                    {!detail.hasCoord && <p className="subtle">좌표 정보가 등록되지 않은 전시입니다.</p>}
                  </div>
                  <span className={`tag ${TAG[detail.status]}`}>{detail.status}</span>
                </div>

                <div className="one-sections">
                  <div className="info-block">
                    <h3>전시 정보</h3>
                    <dl>
                      <dt>전시 기간</dt><dd>{detail.period}</dd>
                      <dt>요일별 운영</dt><dd>{detail.hours}</dd>
                      <dt>휴관</dt><dd>{detail.closed}</dd>
                      <dt>입장 마감</dt><dd>{detail.lastEntry}</dd>
                    </dl>
                  </div>

                  <div className="info-block">
                    <h3>관람 안내</h3>
                    <dl>
                      <dt>입장 방식</dt><dd>{detail.entry}</dd>
                      <dt>예약 여부</dt><dd>{detail.reservation}</dd>
                      <dt>예상 관람 시간</dt><dd>{detail.duration}</dd>
                    </dl>
                  </div>

                  <div className="info-block">
                    <h3>방문 판정</h3>
                    <strong className={`result-text ${TAG[detail.status]}`}>{detail.status}</strong>
                    <p>{detail.reason}</p>
                    <div className="source-info">
                      <span>출처: {detail.source}</span>
                      <span>확인일: {detail.checked}</span>
                    </div>
                    <div className="link-row">
                      {detail.official && <a href={detail.official} target="_blank" rel="noreferrer">공식 홈페이지 ↗</a>}
                      {detail.portal && <a href={detail.portal} target="_blank" rel="noreferrer">서울문화포털 ↗</a>}
                      <a href={detail.mapUrl} target="_blank" rel="noreferrer">카카오맵 ↗</a>
                    </div>
                  </div>

                  <div className="info-block">
                    <h3>다른 관람자의 기록</h3>
                    <div className="visitor-stats">
                      <div>
                        <strong>{rating && rating.level !== 'none' && rating.averageRating !== null ? `★ ${rating.averageRating.toFixed(1)}` : (rating?.label ?? '기록 부족')}</strong>
                        <span>{rating && rating.level !== 'none' ? rating.label : '평균 별점'}</span>
                      </div>
                      <div>
                        <strong>{rating && rating.level !== 'none' && rating.medianMinutes !== null ? `${rating.medianMinutes}분` : detail.duration}</strong>
                        <span>{rating && rating.level !== 'none' && rating.medianMinutes !== null ? '실제 관람 시간' : '예상 관람 시간'}</span>
                      </div>
                      <div><strong>정보 없음</strong><span>혼잡도</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {detail && similar.length > 0 && (
            <section className="info-block one-similar" aria-label="비슷한 전시">
              <h3>비슷한 전시</h3>
              <div className="one-similar-list">
                {similar.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="one-card"
                    onClick={(e) => { e.currentTarget.closest('.one-body')?.scrollTo({ top: 0 }); OPEN(item.id, item.judge) }}
                  >
                    {item.poster && (
                      <div className="one-poster">
                        <img src={item.poster} alt={item.title} loading="lazy" decoding="async" />
                        <span className={`status-tag ${TAG[item.status]}`}>{item.status}</span>
                      </div>
                    )}
                    {!item.poster && <span className={`tag ${TAG[item.status]} one-similar-status`}>{item.status}</span>}
                    <strong>{item.title}</strong>
                    <span className="one-sub">{item.venue}</span>
                    <span className="one-source">{item.tags}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

export default function OneExhibit({ id, title, venue, status, judge, poster, lines = [] }: Props) {
  return (
    <button type="button" className="one-card" onClick={() => OPEN(id, judge)}>
      <div className="one-poster">
        {poster ? <img src={poster} alt={title} loading="lazy" decoding="async" /> : <div className="poster-empty">포스터 없음</div>}
        <span className={`status-tag ${TAG[status]}`}>{status}</span>
      </div>
      <strong>{title}</strong>
      <span className="one-sub">{venue}</span>
      {lines.filter(Boolean).map((line, index) => (
        <span key={index} className={index === 0 ? 'one-meta' : 'one-source'}>{line}</span>
      ))}
    </button>
  )
}