import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import OneExhibit, { type Status } from '../components/OneExhibit'
import { readVisitedIds } from '../lib/archive'
import { displayVenueName, getCatalog, getHolidays, judgeCatalog, todayInSeoul } from '../lib/catalog'
import { buildListItems, DEFAULT_SORT, filterListItems, filterOptions, hasAnyDistance, SORT_OPTIONS, sortListItems, type ListItem, type SortKey } from '../lib/listItems'
import { fetchStats, getCachedStats, subscribeStats } from '../lib/sharedRatings'
import type { JudgeResult } from '../types'

type Area = (typeof AREAS)[number]
type Card = { id: string; title: string; venue: string; status: Status; judge: JudgeResult; poster?: string; lines: string[] }

const AREAS = ['전체', '종로구', '중구'] as const
const STATUS: Record<JudgeResult['result'], Status> = { possible: '가능', impossible: '불가', unknown: '확인 필요' }
const SUBROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 10, marginTop: -16 }
const COUNTROW: CSSProperties = { display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }
const MINI: CSSProperties = { fontSize: 12, minHeight: 30, minWidth: 'auto', padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 4 }

// 서울 현재 날짜/시각 반환
function NOW() {
  const now = new Date()
  return { date: todayInSeoul(now), time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) }
}

// 아카이브 관람 전시 ID 집합 조회
function CONQUERED(): Set<string> {
  return readVisitedIds()
}

// 선택 상태별 칩 스타일 반환
function LOOK(on: boolean, off = false, compact = false): CSSProperties {
  const base = compact ? MINI : {}
  if (off) return { ...base, backgroundColor: '#f3f4f6', borderColor: '#d1d5db', color: '#9ca3af', fontWeight: 700, cursor: 'not-allowed' }
  return on ? { ...base, backgroundColor: '#111111', borderColor: '#111111', color: '#ffffff', fontWeight: 800, boxShadow: '0 2px 6px rgba(0, 0, 0, 0.14)', transform: 'translateY(-1px)' } : { ...base, backgroundColor: '#ffffff', borderColor: '#111111', color: '#111111', fontWeight: 700 }
}

// 선택 가능 칩 버튼
function CHIP({ on, off = false, compact = false, title, run, children }: { on: boolean; off?: boolean; compact?: boolean; title?: string; run: () => void; children: ReactNode }) {
  return (
    <button type="button" disabled={off} title={title} className={on ? 'chip chosen' : 'chip'} style={LOOK(on, off, compact)} aria-pressed={on} onClick={run}>
      {children}
    </button>
  )
}

// 칩 내부 건 숫자 표시
function NUM({ on, value }: { on: boolean; value: number }) {
  return <span style={{ color: on ? '#ff6b6b' : 'crimson', fontWeight: 800 }}>{value}</span>
}

// 출처 문자열 long URL 제거
function SOURCE(raw?: string): string {
  if (!raw) return '서울 열린데이터광장'
  const clean = raw.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  return clean || '서울 열린데이터광장'
}

// 목록 항목 화면 카드 변환
function CARD(item: ListItem): Card {
  const { entry, judge } = item
  const { exhibition, venue } = entry
  const origin = venue ? `${SOURCE(venue.source)} · ${venue.verified}` : '서울 열린데이터광장'
  return { id: exhibition.id, title: exhibition.title, venue: displayVenueName(entry) || '장소 미상', status: STATUS[judge.result], judge, poster: exhibition.imageUrl || undefined, lines: [`${exhibition.start} ~ ${exhibition.end}`, origin] }
}

// 전시 카드 및 관람 오버레이
function ITEM({ item, done }: { item: Card; done: boolean }) {
  return (
    <div className={done ? 'conquered-card' : undefined} style={{ minWidth: 0 }}>
      <OneExhibit id={item.id} title={item.title} venue={item.venue} status={item.status} judge={item.judge} poster={item.poster} lines={item.lines} />
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
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT)
  const [openOnly, setOpenOnly] = useState(false)
  const [field, setField] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)

  const stats = useSyncExternalStore(subscribeStats, getCachedStats)
  const { date, time } = useMemo(() => NOW(), [])
  const catalog = useMemo(() => getCatalog(), [])
  const holidays = useMemo(() => getHolidays(), [])
  const done = useMemo(() => CONQUERED(), [])

  useEffect(() => {
    void fetchStats()
  }, [])

  const base = useMemo(() => {
    const active = catalog.filter(({ exhibition }) => (!exhibition.start || exhibition.start <= date) && (!exhibition.end || exhibition.end >= date))
    const judged = judgeCatalog(active, { date, stayStart: time, stayEnd: '23:59' }, holidays)
    return buildListItems(judged, { ratingStats: stats.exhibitions, tagStats: stats.tags })
  }, [catalog, holidays, date, time, stats])

  const opts = useMemo(() => filterOptions(base), [base])
  const canDistance = useMemo(() => hasAnyDistance(base), [base])

  const items = useMemo(() => {
    const filtered = filterListItems(base, {
      openNow: openOnly,
      areas: area === '전체' ? undefined : [area],
      fields: field ? [field] : undefined,
      tag: tag ?? undefined,
    })
    return sortListItems(filtered, sort).map(CARD)
  }, [base, openOnly, area, field, tag, sort])

  const hasSub = opts.tags.length > 0 || opts.fields.length > 1

  return (
    <section>
      <div className="filter-row">
        <div className="chips">
          {AREAS.map((name) => (
            <CHIP key={name} on={area === name} run={() => setArea(name)}>{name}</CHIP>
          ))}
          <CHIP on={openOnly} run={() => setOpenOnly((v) => !v)}>지금 관람 가능</CHIP>
        </div>

        <div className="chips">
          <CHIP on={sort === DEFAULT_SORT} run={() => setSort(DEFAULT_SORT)}>기본순</CHIP>
          {SORT_OPTIONS.map((opt) => {
            const off = opt.key === 'distance' && !canDistance
            const on = sort === opt.key
            return (
              <CHIP key={opt.key} on={on} off={off} title={off ? '기준 위치가 없어 사용할 수 없습니다' : undefined} run={() => setSort(on ? DEFAULT_SORT : opt.key)}>
                {opt.label}
              </CHIP>
            )
          })}
        </div>
      </div>

      {hasSub && (
        <div style={SUBROW}>
          {opts.fields.length > 1 && opts.fields.map((f) => {
            const on = field === f.value
            return (
              <CHIP key={`f:${f.value}`} on={on} compact run={() => setField(on ? null : f.value)}>
                <span>{f.value}</span>
                <NUM on={on} value={f.count} />
              </CHIP>
            )
          })}
          {opts.tags.map((t) => {
            const on = tag === t.value
            return (
              <CHIP key={`t:${t.value}`} on={on} compact run={() => setTag(on ? null : t.value)}>
                <span>#{t.value}</span>
                <NUM on={on} value={t.count} />
              </CHIP>
            )
          })}
        </div>
      )}

      <div style={hasSub ? COUNTROW : { ...COUNTROW, marginTop: -16 }}>
        <span className="count">{items.length}건</span>
      </div>

      {items.length ? (
        <div className="card-grid">
          {items.map((item) => (
            <ITEM key={item.id} item={item} done={done.has(item.id)} />
          ))}
        </div>
      ) : (
        <p className="empty-result">표시할 전시가 없습니다.</p>
      )}
    </section>
  )
}

export default Hannune