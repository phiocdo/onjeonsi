import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useNavigate } from 'react-router-dom'
import exhibitions from '../../data/exhibitions/auto.json'
import holidaysData from '../../data/holidays/holidays.json'
import { calculateDistance, sortByDistance, type Coordinate } from '../engine/distance'
import { matchVenue } from '../engine/matchVenue'
import { judgeResolved, resolveSchedule } from '../engine/resolveSchedule'
import type { Exhibition, JudgeResult, ParsedOperatingHours, Venue } from '../types'
import ExhibitCard from '../components/ExhibitCard'
import './NearbyExhibitions.css'

declare global {
  interface Window { kakao: any }
}

type Status = '가능' | '불가' | '확인 필요'
type Entry = (typeof exhibitions)[number]
type Item = { id: string; title: string; placeName: string; lat: number | null; lng: number | null; dist: number | null; in: boolean; judge: JudgeResult }
type Spot = 'here' | 'home' | 'pick'

const BASE: Coordinate = { lat: 37.5759, lng: 126.9768 }
const RADII = [500, 1000, 2000]
const ZOOM: Record<number, number> = { 500: 5, 1000: 6, 2000: 7 }
const HINT: CSSProperties = { color: '#ffffff' }
const STATUS: Record<JudgeResult['result'], Status> = { possible: '가능', impossible: '불가', unknown: '확인 필요' }
const VENUES: Venue[] = Object.values(import.meta.glob('../../data/venues/*.json', { eager: true, import: 'default' })).flat() as Venue[]
const HOLIDAYS: string[] = Array.isArray(holidaysData) ? holidaysData : Array.isArray((holidaysData as any)?.holidays) ? (holidaysData as any).holidays.map((h: any) => (typeof h === 'string' ? h : h.date)) : []

// 서울 날짜/시각 반환
function NOW() {
  const now = new Date()
  return { date: now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }), time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) }
}

// 유효 좌표 추출
function COORD(lat: unknown, lng: unknown): Coordinate | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null
  return { lat, lng }
}

// 전시 일치 시설 조회
function VENUE(ex: Entry): Venue | undefined {
  const id = ex.venueId || matchVenue(ex, VENUES).venueId
  return id ? VENUES.find((v) => v.id === id) : undefined
}

// 전시별 최종 좌표 반환
function POS(ex: Entry, venue?: Venue): Coordinate | null {
  return COORD(ex.lat, ex.lng) ?? (venue ? COORD(venue.lat, venue.lng) : null)
}

// 전시 항목 변환 및 관람 판정
function ITEM(ex: Entry, venue: Venue | undefined, pos: Coordinate | null, dist: number | null, inside: boolean, date: string, time: string): Item {
  const placeName = ex.placeName ?? venue?.name ?? '장소 미상'
  const hours = ex.operatingHours as ParsedOperatingHours | undefined
  const exhibition: Exhibition = { ...(ex as unknown as Exhibition), venueId: venue?.id ?? ex.venueId, placeName, lat: pos?.lat, lng: pos?.lng, operatingHours: hours }
  const resolved = resolveSchedule(venue ?? null, hours, { useExhibitionHours: true })
  const res = judgeResolved({ exhibition, date, stayStart: time, stayEnd: '23:59', holidays: HOLIDAYS }, resolved)
  return { id: ex.id, title: ex.title, placeName, lat: pos?.lat ?? null, lng: pos?.lng ?? null, dist, in: inside, judge: res }
}

// 판정 결과 요약 문구 생성
function LINE(res: JudgeResult, time: string): string {
  if (res.result !== 'possible') return res.reasons[0] ?? ''
  const entry = res.entryTime && res.entryTime > time ? `${res.entryTime} 입장 가능` : '현재 관람 가능합니다.'
  return res.lastEntryAssumed ? `${entry} (입장 마감 확인 필요)` : entry
}

// 동일 장소 전시 묶음
function GROUP(list: Item[]) {
  return Object.values(list.reduce<Record<string, Item[]>>((acc, ex) => {
    const key = ex.lat == null || ex.lng == null ? ex.placeName : `${ex.lat},${ex.lng}`
    ;(acc[key] ||= []).push(ex)
    return acc
  }, {}))
}

// 지도 핀 상태 판별
function PIN(items: Item[]) {
  const inside = items.filter((x) => x.in)
  if (!inside.length) return 'out'
  const best = inside.find((x) => x.judge.result === 'possible') ?? inside.find((x) => x.judge.result === 'unknown') ?? inside[0]
  return best.judge.result
}

// 문자열 기반 고정 난수 생성
function SEED(text: string, salt: number) {
  let h = salt
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 9973
  return h / 9973
}

// 위치 미상 장소 좌표 배치
function SCATTER(key: string): CSSProperties {
  return { left: `${8 + SEED(key, 7) * 84}%`, top: `${16 + SEED(key, 13) * 76}%` }
}

// 법정동 조회
function DONG(pos: Coordinate, fallback: string, done: (name: string) => void) {
  const svc = window.kakao?.maps?.services
  if (!svc) { done(fallback); return }
  new svc.Geocoder().coord2RegionCode(pos.lng, pos.lat, (res: any[], status: string) => {
    const found = status === svc.Status.OK ? res.find((r) => r.region_type === 'B') : null
    done(found ? `${found.region_2depth_name} ${found.region_3depth_name}` : fallback)
  })
}

// 선택 칩 스타일 반환
function LOOK(on: boolean): CSSProperties {
  return on ? { backgroundColor: '#d8ff3e', color: '#111111', fontWeight: 800, boxShadow: '0 0 0 2px #111111', transform: 'translateY(-1px)' } : { backgroundColor: '#ffffff', color: '#111111' }
}

// 선택 가능 칩 버튼
function CHIP({ on, run, children }: { on: boolean; run: () => void; children: ReactNode }) {
  return <button type="button" className={on ? 'chip chosen' : 'chip'} style={LOOK(on)} aria-pressed={on} onClick={run}>{children}</button>
}

// 장소별 전시 말풍선
function INFO({ items, pick }: { items: Item[]; pick: (item: Item) => void }) {
  return (
    <div className="info-box">
      <strong>{items[0].placeName}</strong>
      {items.map((item) => (
        <button key={item.id} type="button" className="info-row" onClick={() => pick(item)}>
          <span className={item.in ? `badge ${item.judge.result}` : 'badge out'}>{item.in ? STATUS[item.judge.result] : '반경 밖'}</span>
          <span>{item.title}</span>
        </button>
      ))}
    </div>
  )
}

// 반경 및 전시 핀
function MARK(map: any, center: Coordinate, radius: number, spots: Item[][], go: (item: Item) => void) {
  const layers: any[] = []
  const pos = new window.kakao.maps.LatLng(center.lat, center.lng)
  const dot = document.createElement('div')
  dot.className = 'center-dot'

  map.setCenter(pos)
  map.setLevel(ZOOM[radius] ?? 6)
  layers.push(new window.kakao.maps.Circle({ center: pos, radius, strokeWeight: 2, strokeColor: '#111111', strokeOpacity: 0.8, fillColor: '#d8ff3e', fillOpacity: 0.18, map }))
  layers.push(new window.kakao.maps.CustomOverlay({ position: pos, content: dot, zIndex: 10, map }))

  const info = new window.kakao.maps.InfoWindow({ removable: true })
  const host = document.createElement('div')
  const root = createRoot(host)
  let openId: string | null = null

  spots.forEach((items) => {
    const state = PIN(items)
    const position = new window.kakao.maps.LatLng(items[0].lat!, items[0].lng!)
    const pin = document.createElement('div')
    pin.className = `pin ${state}`
    if (items.length > 1) pin.textContent = String(items.length)

    layers.push(new window.kakao.maps.CustomOverlay({ position, content: pin, yAnchor: 0.5, clickable: true, zIndex: state === 'out' ? 2 : 5, map }))
    ;['mousedown', 'touchstart'].forEach((t) => pin.addEventListener(t, (e) => e.stopPropagation()))

    const spotId = items[0].id
    pin.addEventListener('click', (e) => {
      e.stopPropagation()
      if (openId === spotId) { info.close(); openId = null; return }
      flushSync(() => root.render(<INFO items={items} pick={go} />))
      info.setContent(host)
      info.setPosition(position)
      info.open(map)
      openId = spotId
    })
  })

  return () => { info.close(); layers.forEach((o) => o.setMap(null)); setTimeout(() => root.unmount()) }
}

function NearbyExhibitions() {
  const nav = useNavigate()
  const navRef = useRef(nav)
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [fail] = useState(() => !window.kakao?.maps)
  const [center, setCenter] = useState<Coordinate>(BASE)
  const [label, setLabel] = useState('종로구 세종로')
  const [radius, setRadius] = useState(1000)
  const [spot, setSpot] = useState<Spot>('home')
  const [blind, setBlind] = useState(false)
  const [pop, setPop] = useState<string | null>(null)

  useEffect(() => { navRef.current = nav }, [nav])
  const go = useCallback((item: Item) => navRef.current(`/overview/${item.id}`, { state: { judge: item.judge } }), [])
  const { date, time } = useMemo(() => NOW(), [])

  const rows = useMemo(() => exhibitions.filter((ex) => ex.start <= date && date <= ex.end).map((ex) => {
    const venue = VENUE(ex)
    return { ex, venue, pos: POS(ex, venue) }
  }), [date])

  const all = useMemo(() => {
    const placed = rows.filter((r): r is { ex: Entry; venue: Venue | undefined; pos: Coordinate } => r.pos !== null)
    return sortByDistance(placed, center, (r) => r.pos).map(({ ex, venue, pos }) => {
      const dist = calculateDistance(center, pos)
      return ITEM(ex, venue, pos, dist, dist <= radius, date, time)
    })
  }, [rows, center, radius, date, time])

  const lost = useMemo(() => rows.filter((r) => r.pos === null).map(({ ex, venue }) => ITEM(ex, venue, null, null, true, date, time)), [rows, date, time])

  const near = useMemo(() => all.filter((ex) => ex.in), [all])
  const spots = useMemo(() => GROUP(all), [all])
  const lostSpots = useMemo(() => GROUP(lost), [lost])
  const list = blind ? lost : near

  // 기준 좌표와 법정동 갱신
  const MOVE = useCallback((next: Coordinate, fallback: string, at: Spot) => {
    setBlind(false)
    setSpot(at)
    setCenter(next)
    DONG(next, fallback, setLabel)
  }, [])

  // 현재 위치 좌표
  function LOCATE() {
    if (!navigator.geolocation) { alert('이 브라우저에서는 현재 위치를 쓸 수 없습니다.'); return }
    navigator.geolocation.getCurrentPosition((pos) => MOVE({ lat: pos.coords.latitude, lng: pos.coords.longitude }, '현재 위치', 'here'), () => alert('위치 권한이 거부되었습니다.'))
  }

  useEffect(() => {
    if (fail) return
    window.kakao.maps.load(() => {
      if (mapRef.current || !boxRef.current) return
      const map = new window.kakao.maps.Map(boxRef.current, { center: new window.kakao.maps.LatLng(BASE.lat, BASE.lng), level: 6, disableDoubleClickZoom: true })
      window.kakao.maps.event.addListener(map, 'dblclick', (e: any) => MOVE({ lat: e.latLng.getLat(), lng: e.latLng.getLng() }, '선택한 위치', 'pick'))
      mapRef.current = map
      setReady(true)
    })
  }, [fail, MOVE])

  useEffect(() => {
    if (!mapRef.current) return
    return MARK(mapRef.current, center, radius, spots, go)
  }, [ready, center, radius, spots, go])

  return (
    <section className="nearby">
      <div className="nearby-head">
        <div>
          <h1>{blind ? '위치 정보 없음' : label}</h1>
          <p className="hint" style={HINT}>{blind ? '위치를 알 수 없는 전시입니다.' : '지도를 두 번 눌러 위치를 변경하십시오.'}</p>
        </div>
      </div>

      <div className="map-box">
        <div ref={boxRef} className="map" />
        {fail && <p className="map-error">지도를 불러오지 못했습니다.</p>}

        {blind && (
          <div className="lost-area" onClick={() => setPop(null)}>
            {lostSpots.map((items) => {
              const key = items[0].placeName
              return (
                <div key={key} className="lost-spot" style={{ ...SCATTER(key), zIndex: pop === key ? 10 : 1 }}>
                  <div className={`pin ${PIN(items)}`} onClick={(e) => { e.stopPropagation(); setPop(pop === key ? null : key) }}>{items.length > 1 ? items.length : null}</div>
                  {pop === key && <div className="lost-pop" onClick={(e) => e.stopPropagation()}><INFO items={items} pick={go} /></div>}
                </div>
              )
            })}
            <p className="lost-title">위치 정보 없는 전시 {lost.length}건</p>
          </div>
        )}

        <div className="map-controls">
          <CHIP on={!blind && spot === 'here'} run={LOCATE}>현재 위치</CHIP>
          <CHIP on={!blind && spot === 'home'} run={() => MOVE(BASE, '종로구 세종로', 'home')}>광화문</CHIP>
          {RADII.map((r) => (
            <CHIP key={r} on={!blind && r === radius} run={() => { setBlind(false); setRadius(r) }}>{r < 1000 ? `${r}m` : `${r / 1000}km`}</CHIP>
          ))}
          <CHIP on={blind} run={() => setBlind(true)}>위치 파악 불가능</CHIP>
        </div>
      </div>

      <div className="filter-row nearby-count">
        <span className="count">전시 {list.length}건</span>
      </div>

      {list.length ? (
        <div className="card-grid">
          {list.map((ex) => (
            <ExhibitCard key={ex.id} to={`/overview/${ex.id}`} state={{ judge: ex.judge }} title={ex.title} venue={ex.placeName} status={STATUS[ex.judge.result]} lines={[ex.dist == null ? '위치 정보 없음' : `${ex.dist}m`, LINE(ex.judge, time)]} />
          ))}
        </div>
      ) : (
        <p className="empty-result">오늘 볼 수 있는 전시가 없습니다.</p>
      )}
    </section>
  )
}

export default NearbyExhibitions