import { rawExhibits, seedRecords } from './seed'

export type Status = '가능' | '확인 필요' | '불가'
export type JudgeKey = 'possible' | 'impossible' | 'unknown'

export type Category =
  | '현대미술'
  | '회화'
  | '사진·영상'
  | '조각·설치'
  | '미디어아트'
  | '공예·디자인'
  | '역사·민속'

export type Exhibit = {
  id: number
  name: string
  venue: string
  area: '종로구' | '중구'
  address: string
  category: Category
  poster: string
  distance: number
  angle: number
  duration: number
  rating: number
  visits: number
  crowd: string
  period: string
  hours: string
  open: [number, number]
  closed: string
  lastEntry: string
  entry: string
  reservation: string
  docent: string
  status: Status
  reason: string
  source: string
  checked: string
  official: string
}

type Defaulted =
  | 'hours'
  | 'open'
  | 'closed'
  | 'lastEntry'
  | 'entry'
  | 'reservation'
  | 'docent'
  | 'status'
  | 'reason'
  | 'source'
  | 'checked'

export type RawExhibit = Omit<Exhibit, Defaulted> & Partial<Pick<Exhibit, Defaulted>>

export type ArchiveEntry = {
  id: string
  exhibitId: number
  date: string
  rating: number
  time: number
  note: string
  shared: boolean
}

export const JUDGE_STATUS: Record<JudgeKey, Status> = {
  possible: '가능',
  impossible: '불가',
  unknown: '확인 필요',
}

export const categories: Category[] = [
  '현대미술',
  '회화',
  '사진·영상',
  '조각·설치',
  '미디어아트',
  '공예·디자인',
  '역사·민속',
]

const defaults = {
  hours: '화–일 10:00–18:00',
  open: [600, 1080] as [number, number],
  closed: '매주 월요일',
  lastEntry: '17:30',
  entry: '현장 발권',
  reservation: '예약 불필요',
  docent: '별도 운영 없음',
  status: '가능' as Status,
  reason: '운영 시간 안에 관람할 수 있어요.',
  checked: '2026.11.08',
}

export const exhibits: Exhibit[] = rawExhibits.map((item) => ({
  ...defaults,
  source: `${item.venue} 공식 홈페이지`,
  ...item,
}))

export { seedRecords }

export function statusClass(status: Status) {
  if (status === '확인 필요') return 'check'
  return status === '가능' ? 'possible' : 'impossible'
}

export function exhibitById(id: number) {
  return exhibits.find((item) => item.id === id)
}

export function formatDate(iso: string) {
  return iso.replaceAll('-', '.')
}

export function formatMinutes(value: number) {
  const h = String(Math.floor(value / 60)).padStart(2, '0')
  const m = String(value % 60).padStart(2, '0')
  return `${h}:${m}`
}

export function todayIso() {
  return new Date().toLocaleDateString('sv-SE')
}

export function posterUrl(name: string) {
  return `${import.meta.env.BASE_URL}${name}`
}

export function getStats(item: Exhibit, records: ArchiveEntry[]) {
  const shared = records.filter((record) => record.exhibitId === item.id && record.shared)
  const count = item.visits + shared.length
  const ratingSum = shared.reduce((sum, record) => sum + record.rating, 0)
  const timeSum = shared.reduce((sum, record) => sum + record.time, 0)
  return {
    count,
    rating: (item.rating * item.visits + ratingSum) / count,
    time: Math.round((item.duration * item.visits + timeSum) / count),
  }
}