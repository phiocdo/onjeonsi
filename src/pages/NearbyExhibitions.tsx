import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import exhibitions from '../../data/exhibitions/auto.json'
import { calculateDistance, sortByDistance, type Coordinate } from '../engine/distance'
import type { JudgeResult } from '../types'
import { mockItems } from '../mock/data'
import { JUDGE_STATUS } from '../mock/exhibits'
import ExhibitCard from '../components/ExhibitCard'
import './NearbyExhibitions.css'

declare global {
  interface Window { kakao: any }
}

type Item = { id: string | number; title: string; placeName: string; lat: number; lng: number; dist: number; in: boolean; judge: JudgeResult }

const BASE: Coordinate = { lat: 37.5759, lng: 126.9768 }
const RADII = [500, 1000, 2000]
const ZOOM: Record<number, number> = { 500: 5, 1000: 6, 2000: 7 }
const CHIP = { backgroundColor: '#ffffff', color: '#111111' }
const HINT = { color: '#ffffff' }

// 장소 말풍선 DOM 생성
function INFO(items: Item[], pick: (item: Item) => void) {
  const box = document.createElement('div')
  box.className = 'info-box'
  const name = document.createElement('strong')
  name.textContent = items[0].placeName
  box.appendChild(name)
  items.forEach((item) => {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'info-row'
    const badge = document.createElement('span')
    badge.className = item.in ? `badge ${item.judge.result}` : 'badge out'
    badge.textContent = item.in ? JUDGE_STATUS[item.judge.result] : '반경 밖'
    const title = document.createElement('span')
    title.textContent = item.title
    row.append(badge, title)
    row.addEventListener('click', () => pick(item))
    box.appendChild(row)
  })
  return box
}

// 동일 좌표 전시 묶음
function GROUP(list: Item[]) {
  return Object.values(
    list.reduce<Record<string, Item[]>>((acc, ex) => {
      const key = `${ex.lat},${ex.lng}`
      ;(acc[key] ||= []).push(ex)
      return acc
    }, {})
  )
}

// 지도 핀 상태 판별
function PIN(items: Item[]) {
  const inside = items.filter((x) => x.in)
  if (!inside.length) return 'out'
  const best = inside.find((x) => x.judge.result === 'possible') ?? inside.find((x) => x.judge.result === 'unknown') ?? inside[0]
  return best.judge.result
}

// 법정동 이름 조회
function DONG(pos: Coordinate, fallback: string, done: (name: string) => void) {
  const svc = window.kakao?.maps?.services
  if (!svc) { done(fallback); return }
  new svc.Geocoder().coord2RegionCode(pos.lng, pos.lat, (res: any[], status: string) => {
    const found = status === svc.Status.OK ? res.find((r) => r.region_type === 'B') : null
    done(found ? `${found.region_2depth_name} ${found.region_3depth_name}` : fallback)
  })
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

  useEffect(() => { navRef.current = nav }, [nav])

  const all = useMemo<Item[]>(() => {
    const today = new Date().toLocaleDateString('sv-SE')
    const valid = exhibitions.filter((ex) => ex.lat != null && ex.lng != null && ex.start <= today && today <= ex.end)
    const sorted = sortByDistance(valid, center, (ex) => ({ lat: ex.lat!, lng: ex.lng! }))
    return sorted.map((ex, i) => {
      const dist = calculateDistance(center, { lat: ex.lat!, lng: ex.lng! })
      return { id: ex.id, title: ex.title, placeName: ex.placeName, lat: ex.lat!, lng: ex.lng!, dist, in: dist <= radius, judge: mockItems[i % mockItems.length].judgeResult }
    })
  }, [center, radius])

  const near = useMemo(() => all.filter((ex) => ex.in), [all])
  const spots = useMemo(() => GROUP(all), [all])

  // 기준 좌표와 법정동 라벨 갱신
  function MOVE(next: Coordinate, fallback: string) {
    setCenter(next)
    DONG(next, fallback, setLabel)
  }

  // 현재 위치 좌표 설정
  function LOCATE() {
    if (!navigator.geolocation) { alert('이 브라우저에서는 현재 위치를 쓸 수 없습니다.'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => MOVE({ lat: pos.coords.latitude, lng: pos.coords.longitude }, '현재 위치'),
      () => alert('위치 권한이 거부되었습니다.')
    )
  }

  useEffect(() => {
    if (fail) return
    window.kakao.maps.load(() => {
      if (mapRef.current || !boxRef.current) return
      const map = new window.kakao.maps.Map(boxRef.current, { center: new window.kakao.maps.LatLng(BASE.lat, BASE.lng), level: 6, disableDoubleClickZoom: true })
      window.kakao.maps.event.addListener(map, 'dblclick', (e: any) => MOVE({ lat: e.latLng.getLat(), lng: e.latLng.getLng() }, '선택한 위치'))
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
    let openId: string | number | null = null
    const go = (item: Item) => navRef.current(`/overview/${item.id}`, { state: { judge: item.judge } })

    spots.forEach((items) => {
      const state = PIN(items)
      const position = new window.kakao.maps.LatLng(items[0].lat, items[0].lng)
      const pin = document.createElement('div')
      pin.className = `pin ${state}`
      if (items.length > 1) pin.textContent = String(items.length)

      layers.push(new window.kakao.maps.CustomOverlay({ position, content: pin, yAnchor: 0.5, clickable: true, zIndex: state === 'out' ? 2 : 5, map }))
      ;['mousedown', 'touchstart'].forEach((t) => pin.addEventListener(t, (e) => e.stopPropagation()))

      const spotId = items[0].id
      pin.addEventListener('click', (e) => {
        e.stopPropagation()
        if (openId === spotId) { info.close(); openId = null; return }
        info.setContent(INFO(items, go))
        info.setPosition(position)
        info.open(map)
        openId = spotId
      })
    })

    return () => { info.close(); layers.forEach((o) => o.setMap(null)) }
  }, [ready, center, radius, spots])

  return (
    <section className="nearby">
      <div className="nearby-head">
        <div>
          <h1>{label}</h1>
          <p className="hint" style={HINT}>지도를 두 번 눌러 위치를 변경하십시오.</p>
        </div>
        <div className="nearby-controls">
          <div className="chips">
            <button className="chip" style={CHIP} onClick={LOCATE}>현재 위치</button>
            <button className="chip" style={CHIP} onClick={() => MOVE(BASE, '종로구 세종로')}>광화문</button>
          </div>
          <div className="chips">
            {RADII.map((r) => (
              <button key={r} className={r === radius ? 'chip chosen' : 'chip'} style={CHIP} onClick={() => setRadius(r)}>{r < 1000 ? `${r}m` : `${r / 1000}km`}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="map-box">
        <div ref={boxRef} className="map" />
        {fail && <p className="map-error">지도를 불러오지 못했습니다.</p>}
      </div>

      <div className="filter-row nearby-count">
        <span className="count">전시 {near.length}건</span>
      </div>

      {near.length ? (
        <div className="card-grid">
          {near.map((ex) => (
            <ExhibitCard key={ex.id} to={`/overview/${ex.id}`} state={{ judge: ex.judge }} title={ex.title} venue={ex.placeName} status={JUDGE_STATUS[ex.judge.result]} lines={[`${ex.dist}m`, ex.judge.reasons[0] ?? '']} />
          ))}
        </div>
      ) : (
        <p className="empty-result">오늘 볼 수 있는 전시가 없습니다.</p>
      )}
    </section>
  )
}

export default NearbyExhibitions
