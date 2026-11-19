import { useMemo, useState, type ChangeEvent, type CSSProperties } from 'react'
import { DEFAULT_VISIT_MINUTES } from '../engine/constants'
import { basisLabel, displayVenueName, getCatalog, getHolidays, judgeEntry, todayInSeoul, type CatalogEntry } from '../lib/catalog'
import type { Weekday } from '../types'

type Range = { start: string; end: string }

type SlotResult = {
  possible: string[]
  unavailable: { range: string; reason: string }[]
  unknown: { range: string; reason: string }[]
}

const DAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const GAP = 30
const INFO: CSSProperties = { fontSize: 13, margin: '6px 0 0', opacity: 0.78 }

// 시각 문자열 to 분 변환
function MINS(value: string) {
  const [h, m] = value.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

// 분 단위 문자열 변환
function CLOCK(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// 선택 전시 날짜별 운영 안내 문구
function GUIDE(entry: CatalogEntry, date: string) {
  const { exhibition, venue } = entry
  const wd = DAYS[new Date(`${date}T00:00:00+09:00`).getDay()]
  const slot = venue?.hours?.[wd]
  const stay = venue?.visitMinutes ?? DEFAULT_VISIT_MINUTES
  if (slot) return `운영 시간 ${slot.open}–${slot.close} · 예상 관람 ${stay}분`
  if (exhibition.hoursText) return `${exhibition.hoursText} · 예상 관람 ${stay}분`
  return `시설 정보 확인 필요 · 예상 관람 ${stay}분`
}

// 시간대별 추천 시각과 불가 사유 계산
function CHECK(entry: CatalogEntry | null, date: string, ranges: Range[], holidays: string[]): SlotResult {
  if (!entry) return { possible: [], unavailable: [], unknown: [] }
  const possible: string[] = []
  const unavailable: SlotResult['unavailable'] = []
  const unknown: SlotResult['unknown'] = []

  ranges.forEach((range) => {
    const start = MINS(range.start)
    const end = MINS(range.end)
    const label = `${range.start}–${range.end}`

    if (start === null || end === null || end <= start) {
      unavailable.push({ range: label, reason: '종료 시간이 시작 시간보다 빠르거나 같아요.' })
      return
    }

    const whole = judgeEntry(entry, { date, stayStart: range.start, stayEnd: range.end }, holidays)
    const tail = basisLabel(whole.basis) ? ` (${basisLabel(whole.basis)})` : ''
    if (whole.result === 'unknown') {
      unknown.push({ range: label, reason: `${whole.reasons[0] ?? '시설 정보가 없습니다.'}${tail}` })
      return
    }
    if (whole.result === 'impossible') {
      unavailable.push({ range: label, reason: `${whole.reasons[0] ?? '관람 조건을 확인할 수 없어요.'}${tail}` })
      return
    }

    const slots: string[] = []
    for (let t = Math.ceil(start / GAP) * GAP; t < end; t += GAP) {
      const res = judgeEntry(entry, { date, stayStart: CLOCK(t), stayEnd: range.end }, holidays)
      if (res.result === 'possible' && res.entryTime) slots.push(res.entryTime)
    }

    if (slots.length) possible.push(...slots)
    else unavailable.push({ range: label, reason: `${whole.reasons[0] ?? '운영 시간 안에 관람 시간을 확보할 수 없어요.'}${tail}` })
  })

  return { possible: [...new Set(possible)].sort().slice(0, 3), unavailable, unknown }
}

function WhenToGo() {
  const catalog = useMemo(() => getCatalog(), [])
  const holidays = useMemo(() => getHolidays(), [])
  const [date, setDate] = useState(() => todayInSeoul())
  const [exhibitId, setExhibitId] = useState(() => catalog[0]?.exhibition.id ?? '')
  const [ranges, setRanges] = useState<Range[]>([{ start: '10:00', end: '13:00' }, { start: '14:00', end: '18:00' }])

  const target = useMemo(() => catalog.find((e) => e.exhibition.id === exhibitId) ?? catalog[0] ?? null, [catalog, exhibitId])
  const result = useMemo(() => CHECK(target, date, ranges, holidays), [target, date, ranges, holidays])

  // 시간대 항목 추가
  function ADD() {
    setRanges((prev) => [...prev, { start: '10:00', end: '12:00' }])
  }

  // 시간대 항목 삭제
  function DROP(index: number) {
    setRanges((prev) => prev.filter((_, i) => i !== index))
  }

  // 시간대 시각 수정
  function EDIT(index: number, key: 'start' | 'end', event: ChangeEvent<HTMLInputElement>) {
    setRanges((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: event.target.value } : r)))
  }

  if (!target) {
    return (
      <section className="when-page">
        <h1>언제 갈까</h1>
        <p className="empty-result">등록된 전시 정보가 없어요. 전시 데이터를 확인해 주세요.</p>
      </section>
    )
  }

  return (
    <section className="when-page">
      <h1>언제 갈까</h1>

      <div className="when-form">
        <label>
          방문 날짜
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>

        <label>
          전시 선택
          <select value={target.exhibition.id} onChange={(e) => setExhibitId(e.target.value)}>
            {catalog.map((item) => (
              <option key={item.exhibition.id} value={item.exhibition.id}>{item.exhibition.title} · {displayVenueName(item) || '장소 미상'}</option>
            ))}
          </select>
        </label>

        <p className="when-info" style={INFO}>{GUIDE(target, date)}</p>

        <div className="range-heading">
          <h3>머물 수 있는 시간대</h3>
          <button type="button" className="text-button" onClick={ADD}>+ 시간대 추가</button>
        </div>

        {ranges.map((range, index) => (
          <div className="time-range" key={index}>
            <span>시간대 {index + 1}</span>
            <input type="time" value={range.start} onChange={(e) => EDIT(index, 'start', e)} />
            <span>—</span>
            <input type="time" value={range.end} onChange={(e) => EDIT(index, 'end', e)} />
            {ranges.length > 1 && <button type="button" className="remove-time" onClick={() => DROP(index)}>삭제</button>}
          </div>
        ))}
      </div>

      <div className="time-results">
        <div className="result-section">
          <h2>가능한 시각 <span>최대 3개 · 이른 순</span></h2>
          {result.possible.length ? (
            <div className="candidate-list">
              {result.possible.map((time) => (
                <div className="candidate" key={time}>{time}</div>
              ))}
            </div>
          ) : (
            <p className="empty-result">가능한 시간이 없어요.</p>
          )}
        </div>

// 수정 후
        {result.unknown.length > 0 && (
          <div className="result-section">
            <h2>확인 필요 시간대</h2>
            {result.unknown.map((item, index) => (
              <div className="unavailable-item" key={index}>
                <strong>{item.range}</strong>
                <span>{item.reason}</span>
              </div>
            ))}
          </div>
        )}

        <div className="result-section">
          <h2>불가능한 시간대</h2>
          {result.unavailable.length ? (
            result.unavailable.map((item, index) => (
              <div className="unavailable-item" key={index}>
                <strong>{item.range}</strong>
                <span>{item.reason}</span>
              </div>
            ))
          ) : (
            <p className="empty-result">불가능한 시간대가 없어요.</p>
          )}
        </div>
      </div>
    </section>
  )
}

export default WhenToGo
