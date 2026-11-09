import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/Layout'
import NearbyExhibitions from './pages/NearbyExhibitions'
import OverviewList from './pages/OverviewList'
import OverviewPage from './pages/OverviewPage'
import WhenToGo from './pages/When'
import Archive from './pages/Archive'
import Team from './pages/Team'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<NearbyExhibitions />} />
          <Route path="/nearby" element={<NearbyExhibitions />} />
          <Route path="/overview" element={<OverviewList />} />
          <Route path="/overview/:id" element={<OverviewPage />} />
          <Route path="/when" element={<WhenToGo />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/team" element={<Team />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}