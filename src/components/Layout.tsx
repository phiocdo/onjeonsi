import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { fetchStats } from '../lib/sharedRatings'
import SavedMenu from './SavedMenu'

type TAB = {
  TO: string
  LABEL: string
  KEY: 'around' | 'all' | 'when' | 'archive' | 'team'
  END: boolean
}

const TABS: TAB[] = [
  { TO: '/', LABEL: '내 주변', KEY: 'around', END: true },
  { TO: '/overview', LABEL: '한눈에', KEY: 'all', END: false },
  { TO: '/when', LABEL: '언제 갈까', KEY: 'when', END: false },
  { TO: '/archive', LABEL: '아카이브', KEY: 'archive', END: false },
]

const TEAM: TAB = { TO: '/team', LABEL: '팀', KEY: 'team', END: false }

// 탭 아이콘
const ICON = (KEY: TAB['KEY']) => `${import.meta.env.BASE_URL}${KEY}.png`

// 현재 활성 탭
const ACTIVE = (PATH: string): TAB => {
  if (PATH.startsWith(TEAM.TO)) return TEAM
  return TABS.find((ITEM) => (ITEM.END ? PATH === ITEM.TO : PATH.startsWith(ITEM.TO))) ?? TABS[0]
}

// 탭 링크 클래스 반환
const LINK = ({ isActive }: { isActive: boolean }) => (isActive ? 'tab-link active' : 'tab-link')

export default function LAYOUT() {
  const LOC = useLocation()
  const CUR = ACTIVE(LOC.pathname)

  useEffect(() => {
    void fetchStats()
  }, [])

  return (
    <main className="site-shell">
      <img key={CUR.KEY} src={ICON(CUR.KEY)} alt="" aria-hidden="true" style={{ position: 'fixed', top: '-24px', left: '-24px', width: '260px', height: '260px', objectFit: 'contain', opacity: 0.08, pointerEvents: 'none', zIndex: 0, animation: 'icon-pop 0.35s ease-out' }} />

      <header className="topbar">
        <nav className="tab-bar" aria-label="주요 메뉴">
          <div className="tab-list">
            {TABS.map((ITEM) => (
              <NavLink key={ITEM.TO} to={ITEM.TO} end={ITEM.END} className={LINK}>
                {ITEM.LABEL}
              </NavLink>
            ))}
          </div>
        </nav>

        <nav className="team-bar" aria-label="프로젝트 정보">
          <SavedMenu />
          <NavLink to={TEAM.TO} className={LINK}>
            {TEAM.LABEL}
          </NavLink>
        </nav>
      </header>

      <div className="page-content">
        <Outlet />
      </div>
    </main>
  )
}