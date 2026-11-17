import { useMemo, useState } from 'react'
import exhibitions from '../../data/exhibitions/auto.json'
import holidaysData from '../../data/holidays/holidays.json'
import OneExhibit, { type Status } from '../components/OneExhibit'
import { matchVenue } from '../engine/matchVenue'
import { judgeResolved, resolveSchedule } from '../engine/resolveSchedule'
import type { Exhibition, JudgeResult, ParsedOperatingHours, Venue } from '../types'

type Entry = (typeof exhibitions)[number]
type Area = (typeof AREAS)[number]
type Card = { id: string; title: string; venue: string; area: string; status: Status; judge: JudgeResult; poster?: string; lines: string[] }

const AREAS = ['전체', '종로구', '중구'] as const
const STATUS: Record<JudgeResult['result'], Status> = { possible: '가능', impossible: '불가', unknown: '확인 필요' }
const VENUES: Venue[] = Object.values(import.meta.glob('../../data/venues/*.json', { eager: true, import: 'default' })).flat() as Venue[]
const RAW = holidaysData as string[] | { holidays?: Array<string | { date: string }> }
const HOLIDAYS: string[] = Array.isArray(RAW) ? RAW : (RAW.holidays ?? []).map((h) => (typeof h === 'string' ? h : h.date))

// 서울 현재 날짜와 시각 조회
function NOW() {
  const now = new Date()
  return { date: now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }), time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) }
}

// 자치구 판별
function GU(ex: Entry, venue?: Venue): string {
  const saved = (ex as { gu?: string }).gu
  if (saved) return saved
  if (venue?.gu) return venue.gu
  const text = `${ex.placeName ?? ''} ${ex.title}`
  if (text.includes('종로')) return '종로구'
  if (text.includes('중구')) return '중구'
  return ''
}

// 전시 목록 항목 변환
function CARD(ex: Entry, date: string, time: string): Card {
  const id = ex.venueId || matchVenue(ex, VENUES).venueId
  const venue = id ? VENUES.find((v) => v.id === id) : undefined
  const placeName = ex.placeName || venue?.name || '장소 미상'
  const hours = ex.operatingHours as ParsedOperatingHours | undefined
  const exhibition: Exhibition = { ...(ex as unknown as Exhibition), venueId: venue?.id ?? ex.venueId, placeName, operatingHours: hours }
  const judge = judgeResolved({ exhibition, date, stayStart: time, stayEnd: '23:59', holidays: HOLIDAYS }, resolveSchedule(venue ?? null, hours, { useExhibitionHours: true }))
  const source = venue ? `${venue.source} · ${venue.verified}` : '서울 열린데이터광장'

  return { id: ex.id, title: ex.title, venue: placeName, area: GU(ex, venue), status: STATUS[judge.result], judge, poster: ex.imageUrl || undefined, lines: [`${ex.start} ~ ${ex.end}`, source] }
}

export default function Hannune() {
  const [area, setArea] = useState<Area>('전체')
  const { date, time } = useMemo(() => NOW(), [])
  const all = useMemo(() => exhibitions.filter((ex) => !ex.end || ex.end >= date).map((ex) => CARD(ex, date, time)), [date, time])
  const items = useMemo(() => all.filter((item) => area === '전체' || item.area === area), [all, area])

  return (
    <section>
      <div className="filter-row">
        <div className="chips">
          {AREAS.map((name) => (
            <button key={name} type="button" className={area === name ? 'chip chosen' : 'chip'} aria-pressed={area === name} onClick={() => setArea(name)}>
              {name}
            </button>
          ))}
        </div>
        <span className="count">{items.length}개 전시</span>
      </div>

      {items.length ? (
        <div className="card-grid">
          {items.map((item) => (
            <OneExhibit key={item.id} id={item.id} title={item.title} venue={item.venue} status={item.status} judge={item.judge} poster={item.poster} lines={item.lines} />
          ))}
        </div>
      ) : (
        <p className="empty-result">표시할 전시가 없습니다.</p>
      )}
    </section>
  )
}