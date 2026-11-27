import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import OneExhibit, { type Status } from '../components/OneExhibit'
import { readVisitedIds } from '../lib/archive'
import { displayVenueName, getCatalog, getHolidays, judgeCatalog, todayInSeoul } from '../lib/catalog'
import { buildListItems, DEFAULT_SORT, filterListItems, filterOptions, sortListItems, type ListItem, type SortKey } from '../lib/listItems'
import { fetchStats, getCachedStats, subscribeStats } from '../lib/sharedRatings'
import type { JudgeResult } from '../types'

type Area = (typeof AREAS)[number]
type Sort = Exclude<SortKey, 'distance'>

type Card = {
  id: string
  title: string
  venue: string
  status: Status
  judge: JudgeResult
  poster?: string
  lines: string[]
}

type Chip = {
  on: boolean
  onClick: () => void
  children: ReactNode
  compact?: boolean
  label?: string
}

const AREAS = ['전체', '종로구', '중구'] as const
const STATUS: Record<JudgeResult['result'], Status> = { possible: '가능', impossible: '불가', unknown: '확인 필요' }

// 서울 현재 날짜/시각 반환
function NOW() {
  const now = new Date()
  return {
    date: todayInSeoul(now),
    time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }),
  }
}

// 아카이브 기록 전시 ID 집합 조회
function CONQUERED(): Set<string> {
  return readVisitedIds()
}

// 출처 URL 도메인 표시 및 일반 출처 문구 유지
function SOURCE(source: string): string {
  const text = source.trim()
  if (!text) return '출처 정보 없음'

  try {
    const url = new URL(text)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname.replace(/^www\./i, '') || text
  } catch {
    return text
  }

  return text
}

// 공통 필터·정렬 칩
function CHIP({ on, onClick, children, compact = false, label }: Chip) {
  const cls = ['chip', 'hannune-chip', on ? 'chosen' : '', compact ? 'hannune-chip-mini' : ''].filter(Boolean).join(' ')

  return (
    <button type="button" className={cls} aria-pressed={on} aria-label={label} onClick={onClick}>
      {children}
    </button>
  )
}

// 필터 전시 건수
function NUM({ count }: { count: number }) {
  return <span className="hannune-chip-count" aria-hidden="true">{count}</span>
}

// 전시 목록 항목 변환
function CARD({ entry, judge }: ListItem): Card {
  const { exhibition: ex, venue } = entry
  const source = venue ? `${SOURCE(venue.source)} 확인 · ${venue.verified}` : '서울 열린데이터광장'

  return {
    id: ex.id,
    title: ex.title,
    venue: displayVenueName(entry) || '장소 미상',
    status: STATUS[judge.result],
    judge,
    poster: ex.imageUrl || undefined,
    lines: [`${ex.start} ~ ${ex.end}`, source],
  }
}

// 전시 카드 및 관람 완료 오버레이
function ITEM({ item, done }: { item: Card; done: boolean }) {
  return (
    <div className={done ? 'conquered-card' : undefined}>
      <OneExhibit {...item} />
      {done && (
        <div className="conquered-veil" aria-label="정복">
          <span className="conquered-stamp">관람</span>
        </div>
      )}
    </div>
  )
}

function Hannune() {
  const [area, setArea] = useState<Area>('전체')
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT === 'popular' ? 'popular' : 'default')
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)

  const { date, time } = useMemo(() => NOW(), [])
  const catalog = useMemo(() => getCatalog(), [])
  const holidays = useMemo(() => getHolidays(), [])
  const done = useMemo(() => CONQUERED(), [])
  const stats = useSyncExternalStore(subscribeStats, getCachedStats)

  useEffect(() => { void fetchStats() }, [])

  // 현재 진행 중인 전시 <- 오늘 나머지 시간 기준 판정
  const judged = useMemo(() => {
    const active = catalog.filter(({ exhibition: ex }) => (!ex.start || ex.start <= date) && (!ex.end || ex.end >= date))
    return judgeCatalog(active, { date, stayStart: time, stayEnd: '23:59' }, holidays)
  }, [catalog, holidays, date, time])

  // 공통 목록 항목 생성
  const base = useMemo(() => buildListItems(judged, { ratingStats: stats.exhibitions, tagStats: stats.tags }), [judged, stats])

  // 지역·오늘 관람 가능 조건 <- 우선 적용
  const scope = useMemo(() => filterListItems(base, { areas: area === '전체' ? undefined : [area], openNow: open }), [base, area, open])

  // 분야 건수 -> 선택 태그 조건 반영
  const fields = useMemo(() => filterOptions(filterListItems(scope, { tag: tag ?? undefined })).fields, [scope, tag])

  // 태그 건수 -> 선택 분야 조건 반영
  const tags = useMemo(() => filterOptions(filterListItems(scope, { fields: field ? [field] : undefined })).tags, [scope, field])

  // 최종 필터 적용 및 정렬
  const items = useMemo(() => {
    const list = filterListItems(scope, { fields: field ? [field] : undefined, tag: tag ?? undefined })
    return sortListItems(list, sort).map(CARD)
  }, [scope, field, tag, sort])

  // 지역 변경 시 하위 필터 초기화
  function CHANGE(next: Area) {
    setArea(next)
    setField(null)
    setTag(null)
  }

  // 관람 가능 조건 변경 시 하위 필터 초기화
  function TOGGLE() {
    setOpen((prev) => !prev)
    setField(null)
    setTag(null)
  }

  return (
    <section className="hannune-page">
      <div className="filter-row">
        <div className="chips" role="group" aria-label="지역 및 관람 가능 필터">
          {AREAS.map((name) => (
            <CHIP key={name} on={area === name} onClick={() => CHANGE(name)}>{name}</CHIP>
          ))}
          <CHIP on={open} onClick={TOGGLE}>오늘 관람 가능</CHIP>
        </div>

        <div className="chips" role="group" aria-label="전시 정렬">
          <CHIP on={sort === 'default'} onClick={() => setSort('default')}>기본순</CHIP>
          <CHIP on={sort === 'popular'} onClick={() => setSort('popular')}>인기순</CHIP>
        </div>
      </div>

      {(fields.length > 1 || field !== null) && (
        <div className="hannune-subrow" role="group" aria-label="전시 분야 필터">
          {fields.map(({ value, count }) => (
            <CHIP key={value} compact on={field === value} label={`${value}, 전시 ${count}개`} onClick={() => setField(field === value ? null : value)}>
              {value}<NUM count={count} />
            </CHIP>
          ))}
          {field !== null && !fields.some((o) => o.value === field) && (
            <CHIP compact on label={`${field}, 전시 0개`} onClick={() => setField(null)}>
              {field}<NUM count={0} />
            </CHIP>
          )}
        </div>
      )}

      {(tags.length > 0 || tag !== null) && (
        <div className="hannune-subrow" role="group" aria-label="전시 태그 필터">
          {tags.map(({ value, count }) => (
            <CHIP key={value} compact on={tag === value} label={`${value} 태그, 전시 ${count}개`} onClick={() => setTag(tag === value ? null : value)}>
              #{value}<NUM count={count} />
            </CHIP>
          ))}
          {tag !== null && !tags.some((o) => o.value === tag) && (
            <CHIP compact on label={`${tag} 태그, 전시 0개`} onClick={() => setTag(null)}>
              #{tag}<NUM count={0} />
            </CHIP>
          )}
        </div>
      )}

      <div className="hannune-countrow">
        <span className="count" aria-live="polite">{items.length}개 전시</span>
      </div>

      {items.length ? (
        <div className="card-grid">
          {items.map((item) => <ITEM key={item.id} item={item} done={done.has(item.id)} />)}
        </div>
      ) : (
        <p className="empty-result">표시할 전시가 없습니다.</p>
      )}
    </section>
  )
}

export default Hannune