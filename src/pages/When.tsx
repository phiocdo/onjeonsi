
import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { exhibitById, exhibits, formatMinutes } from '../mock/exhibits'

type Range = { start: string; end: string }
type Exhibit = (typeof exhibits)[number]

type Result = {
  possible: string[]
  unavailable: { range: string; reason: string }[]
}

// 시간 변환
const A = (value: string) => {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

// 관람 가능 시간 계산
const B = (target: Exhibit | null, ranges: Range[]): Result => {
  if (!target) return { possible: [], unavailable: [] }

  const [open, close] = target.open
  const possible: string[] = []
  const unavailable: Result['unavailable'] = []

  ranges.forEach((range) => {
    const start = A(range.start)
    const end = A(range.end)
    const label = `${range.start}–${range.end}`

    if (end <= start) {
      unavailable.push({ range: label, reason: '종료 시간이 시작 시간보다 빠르거나 같아요.' })
      return
    }

    const from = Math.max(start, open)
    const to = Math.min(end, close)

    if (to <= from) {
      unavailable.push({ range: label, reason: `운영 시간(${formatMinutes(open)}–${formatMinutes(close)})과 겹치지 않아요.` })
      return
    }

    const slots: string[] = []

    for (let time = Math.ceil(from / 30) * 30; time + target.duration <= to; time += 30) {
      slots.push(formatMinutes(time))
    }

    if (slots.length) {
      possible.push(...slots)
    } else {
      unavailable.push({ range: label, reason: `운영 시간 안에서 관람 예상 시간 ${target.duration}분을 확보할 수 없어요.` })
    }
  })

  return { possible: [...new Set(possible)].sort().slice(0, 3), unavailable }
}

export default function WhenToGo() {
  const [exhibitId, setExhibitId] = useState(String(exhibits[0]?.id ?? ''))
  const [timeRanges, setTimeRanges] = useState<Range[]>([
    { start: '10:00', end: '13:00' },
    { start: '14:00', end: '18:00' },
  ])

  const TARGET = exhibitById(Number(exhibitId)) ?? exhibits[0] ?? null

  // 결과 계산 함수
  const C = () => B(TARGET, timeRanges)

  // 전시 선택 함수
  const D = (event: ChangeEvent<HTMLSelectElement>) => setExhibitId(event.target.value)

  // 시간대 추가 함수
  const E = () => setTimeRanges([...timeRanges, { start: '10:00', end: '12:00' }])

  // 시간대 삭제 함수
  const F = (index: number) => setTimeRanges(timeRanges.filter((_, i) => i !== index))

  // 시간대 변경 함수
  const G = (index: number, key: 'start' | 'end', event: ChangeEvent<HTMLInputElement>) => {
    setTimeRanges(timeRanges.map((range, i) => i === index ? { ...range, [key]: event.target.value } : range))
  }

  const RESULT = useMemo(C, [TARGET, timeRanges])

  if (!TARGET) {
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
          전시 선택
          <select value={exhibitId} onChange={D}>
            {exhibits.map((item) => (
              <option key={item.id} value={item.id}>{item.name} · {item.venue}</option>
            ))}
          </select>
        </label>

        <p className="when-info">
          운영 시간 {formatMinutes(TARGET.open[0])}–{formatMinutes(TARGET.open[1])} · 예상 관람 {TARGET.duration}분
        </p>

        <div className="range-heading">
          <h3>머물 수 있는 시간대</h3>
          <button type="button" className="text-button" onClick={E}>+ 시간대 추가</button>
        </div>

        {timeRanges.map((range, index) => (
          <div className="time-range" key={index}>
            <span>시간대 {index + 1}</span>
            <input type="time" value={range.start} onChange={G.bind(null, index, 'start')} />
            <span>—</span>
            <input type="time" value={range.end} onChange={G.bind(null, index, 'end')} />

            {timeRanges.length > 1 && (
              <button type="button" className="remove-time" onClick={() => F(index)}>삭제</button>
            )}
          </div>
        ))}
      </div>

      <div className="time-results">
        <div className="result-section">
          <h2>가능한 시각 <span>최대 3개 · 이른 순</span></h2>

          {RESULT.possible.length ? (
            <div className="candidate-list">
              {RESULT.possible.map((time) => (
                <div className="candidate" key={time}>{time}</div>
              ))}
            </div>
          ) : (
            <p className="empty-result">가능한 시간이 없어요.</p>
          )}
        </div>

        <div className="result-section">
          <h2>불가능한 시간대</h2>

          {RESULT.unavailable.length ? (
            RESULT.unavailable.map((item, index) => (
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