import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { fetchStats } from '../lib/sharedRatings'

type TAB_ITEM = {
  TO: string
  LABEL: string
  KEY: 'around' | 'all' | 'when' | 'archive' | 'team'
  END: boolean
}

const TABS: TAB_ITEM[] = [
  { TO: '/', LABEL: '내 주변', KEY: 'around', END: true },
  { TO: '/overview', LABEL: '한눈에', KEY: 'all', END: false },
  { TO: '/when', LABEL: '언제 갈까', KEY: 'when', END: false },
  { TO: '/archive', LABEL: '아카이브', KEY: 'archive', END: false },
  { TO: '/team', LABEL: '팀', KEY: 'team', END: false },
]

// 탭 아이콘 경로 반환
const ICON = (KEY: TAB_ITEM['KEY']) => `${import.meta.env.BASE_URL}${KEY}.png`

// 현재 경로 활성 탭 조회
const ACTIVE = (PATHNAME: string): TAB_ITEM => {
  const FOUND = TABS.find((TAB) => (TAB.END ? PATHNAME === TAB.TO : PATHNAME.startsWith(TAB.TO)))
  return FOUND ?? TABS[0]
}

export default function LAYOUT() {
  const LOCATION = useLocation()
  const ACTIVE_TAB = ACTIVE(LOCATION.pathname)

  useEffect(() => {
    void fetchStats()
  }, [])

  return (
    <main className="site-shell">
      <header className="topbar">
        <nav className="tab-bar" aria-label="주요 메뉴">
          <div className="tab-list">
            {TABS.map((TAB) => (
              <NavLink key={TAB.TO} to={TAB.TO} end={TAB.END} className={({ isActive }) => (isActive ? 'tab-link active' : 'tab-link')}>
                {TAB.LABEL}
              </NavLink>
            ))}
          </div>

          <img key={ACTIVE_TAB.KEY} className="tab-icon" src={ICON(ACTIVE_TAB.KEY)} width={32} height={32} alt="" />
        </nav>
      </header>

      <div className="page-content">
        <Outlet />
      </div>
    </main>
  )
}