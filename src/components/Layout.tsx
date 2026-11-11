import { Link, NavLink, Outlet } from 'react-router-dom'

const TEAM = true

const BASE = [
  { to: '/', label: '내 주변', end: true },
  { to: '/overview', label: '한눈에', end: false },
  { to: '/when', label: '언제 갈까', end: false },
  { to: '/archive', label: '아카이브', end: false },
]

const TABS = TEAM ? [...BASE, { to: '/team', label: 'TEAM', end: false }] : BASE

export default function Layout() {
  return (
    <main className="site-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          ON<span>.</span>JEONSI
        </Link>

        <nav className="tabs">
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => isActive ? 'active' : ''}>
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <div className="page-content">
        <Outlet />
      </div>
    </main>
  )
}