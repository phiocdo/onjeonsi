import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useNavigate } from 'react-router-dom'
import exhibitions from '../../data/exhibitions/auto.json'
import holidaysData from '../../data/holidays/holidays.json'
import { calculateDistance, sortByDistance, type Coordinate } from '../engine/distance'
import { judge } from '../engine/judge'
import type { Exhibition, JudgeResult, ParsedOperatingHours, Venue, Weekday } from '../types'
import ExhibitCard from '../components/ExhibitCard'
import './NearbyExhibitions.css'

declare global {
  interface Window { kakao: any }
}

type Judge = Pick<JudgeResult, 'result' | 'reasons'>
type Entry = (typeof exhibitions)[number]
type Item = { id: string; title: string; placeName: string; lat: number | null; lng: number | null; dist: number | null; in: boolean; judge: Judge }
type Spot = 'here' | 'home' | 'pick'

const BASE: Coordinate = { lat: 37.5759, lng: 126.9768 }
const RADII = [500, 1000, 2000]
const ZOOM: Record<number, number> = { 500: 5, 1000: 6, 2000: 7 }
const HINT = { color: '#ffffff' }
const STATUS: Record<Judge['result'], string> = { possible: '가능', impossible: '불가', unknown: '확인 필요' }
const UNKNOWN: Judge = { result: 'unknown', reasons: ['휴관일·입장 마감 정보를 확인하지 못했습니다.'] }
const DAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const HOLIDAYS: string[] = Array.isArray(holidaysData) ? holidaysData : Array.isArray((holidaysData as any)?.holidays) ? (holidaysData as any).holidays.map((h: any) => (typeof h === 'string' ? h : h.date)) : []

// 판정용 장소 객체 생성
function VENUE(ex: Entry, today: string, day: Weekday): Venue {
  const op = ex.operatingHours as ParsedOperatingHours | undefined
  const hours: Venue['hours'] = {}
  let lastEntry: string | undefined
  let closed: Venue['closed'] | undefined

  if (op?.scheduleType === 'always_open') {
    DAYS.forEach((d) => { hours[d] = { open: '00:00', close: '23:59' } })
    lastEntry = '23:59'
  } else if (op?.scheduleType === 'scheduled') {
    DAYS.forEach((d) => {
      const s = op.weekdays?.[d]
      if (s?.isOpen && s.intervals?.length) hours[d] = { open: s.intervals[0].open, close: s.intervals[s.intervals.length - 1].close }
    })
    const exRule = op.exceptions?.find((e) => e.date === today)?.schedule
    const active = exRule ?? (HOLIDAYS.includes(today) && op.holiday ? op.holiday : op.weekdays?.[day])
    if (active) {
      if (!active.isOpen || !active.intervals.length) {
        delete hours[day]
        closed = { dates: [today] }
      } else {
        hours[day] = { open: active.intervals[0].open, close: active.intervals[active.intervals.length - 1].close }
        lastEntry = active.intervals[active.intervals.length - 1].lastAdmission
      }
    }
  }

  return { id: ex.venueId || ex.id, name: ex.placeName ?? '장소 미상', aliases: [], gu: '종로구', type: '미술관', lat: ex.lat ?? 0, lng: ex.lng ?? 0, representative: false, hours: Object.keys(hours).length ? hours : undefined, closed, lastEntry, source: 'auto.json', verified: ex.fetchedAt ?? today }
}

// 전시 항목 변환 및 관람 가능 여부 판정
function ITEM(ex: Entry, dist: number | null, on: boolean, date: string, time: string, day: Weekday): Item {
  const placeName = ex.placeName ?? '장소 미상'
  if (!on) return { id: ex.id, title: ex.title, placeName, lat: ex.lat, lng: ex.lng, dist, in: false, judge: UNKNOWN }
  const exhibition: Exhibition = { ...(ex as unknown as Exhibition), placeName, lat: ex.lat ?? undefined, lng: ex.lng ?? undefined }
  const res = judge({ venue: VENUE(ex, date, day), exhibition, date, stayStart: time, stayEnd: '23:59', holidays: HOLIDAYS })
  return { id: ex.id, title: ex.title, placeName, lat: ex.lat, lng: ex.lng, dist, in: true, judge: { result: res.result, reasons: res.reasons.length ? res.reasons : ['현재 관람 가능합니다.'] } }
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

// 문자열 기반 고정 난수
function SEED(text: string, salt: number) {
  let h = salt
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 9973
  return h / 9973
}

// 위치 없는 장소 배치
function SCATTER(key: string) {
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

// 칩 선택 효과
function LOOK(on: boolean) {
  return on ? { backgroundColor: '#d8ff3e', color: '#111111', fontWeight: 800, boxShadow: '0 0 0 2px #111111', transform: 'translateY(-1px)' } : { backgroundColor: '#ffffff', color: '#111111' }
}

// 선택 가능 칩 버튼
function CHIP({ on, run, children }: { on: boolean; run: () => void; children: ReactNode }) {
  return <button type="button" className={on ? 'chip chosen' : 'chip'} style={LOOK(on)} aria-pressed={on} onClick={run}>{children}</button>
}

// 장소 말풍선 목록
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

  const live = useMemo(() => {
    const today = new Date().toLocaleDateString('sv-SE')
    return exhibitions.filter((ex) => ex.start <= today && today <= ex.end)
  }, [])

  const all = useMemo(() => {
    const now = new Date()
    const date = now.toLocaleDateString('sv-SE')
    const time = now.toTimeString().slice(0, 5)
    const day = DAYS[now.getDay()]
    const placed = live.filter((ex) => ex.lat != null && ex.lng != null)
    return sortByDistance(placed, center, (ex) => ({ lat: ex.lat!, lng: ex.lng! })).map((ex) => {
      const dist = calculateDistance(center, { lat: ex.lat!, lng: ex.lng! })
      return ITEM(ex, dist, dist <= radius, date, time, day)
    })
  }, [live, center, radius])

  const lost = useMemo(() => {
    const now = new Date()
    const date = now.toLocaleDateString('sv-SE')
    const time = now.toTimeString().slice(0, 5)
    const day = DAYS[now.getDay()]
    return live.filter((ex) => ex.lat == null || ex.lng == null).map((ex) => ITEM(ex, null, true, date, time, day))
  }, [live])

  const near = useMemo(() => all.filter((ex) => ex.in), [all])
  const spots = useMemo(() => GROUP(all), [all])
  const lostSpots = useMemo(() => GROUP(lost), [lost])
  const list = blind ? lost : near

  // 기준 좌표와 법정동 라벨 갱신
  function MOVE(next: Coordinate, fallback: string, at: Spot) {
    setBlind(false)
    setSpot(at)
    setCenter(next)
    DONG(next, fallback, setLabel)
  }

  // 현재 위치 좌표 설정
  function LOCATE() {
    if (!navigator.geolocation) { alert('이 브라우저에서는 현재 위치를 쓸 수 없습니다.'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => MOVE({ lat: pos.coords.latitude, lng: pos.coords.longitude }, '현재 위치', 'here'),
      () => alert('위치 권한이 거부되었습니다.')
    )
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
  }, [fail])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layers: any[] = []
    const pos = new window.kakao.maps.LatLng(center.lat, center.lng)
    map.setCenter(pos)
    map.setLevel(ZOOM[radius] ?? 6)

    layers.push(new window.kakao.maps.Circle({ center: pos, radius, strokeWeight: 2, strokeColor: '#111111', strokeOpacity: 0.8, fillColor: '#d8ff3e', fillOpacity: 0.18, map }))
    layers.push(new window.kakao.maps.CustomOverlay({ position: pos, content: '<div class="center-dot"></div>', zIndex: 10, map }))

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
            <ExhibitCard key={ex.id} to={`/overview/${ex.id}`} state={{ judge: ex.judge }} title={ex.title} venue={ex.placeName} status={STATUS[ex.judge.result]} lines={[ex.dist == null ? '위치 정보 없음' : `${ex.dist}m`, ex.judge.reasons[0] ?? '']} />
          ))}
        </div>
      ) : (
        <p className="empty-result">오늘 볼 수 있는 전시가 없습니다.</p>
      )}
    </section>
  )
}

export default NearbyExhibitions
