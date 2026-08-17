import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import HomePage from './pages/HomePage'
import WorkloadsPage from './pages/WorkloadsPage'
import ConfigurationPage from './pages/ConfigurationPage'
import ResultsPage from './pages/ResultsPage'
import CapacityPage from './pages/CapacityPage'
import ManagementPlanePage from './pages/ManagementPlanePage'
import MethodPage from './pages/MethodPage'
import { fromUrl } from './state/urlState'
import { useSurveyorStore } from './state/store'

export default function App() {
  const loadScenario = useSurveyorStore((state) => state.loadScenario)

  useEffect(() => {
    const shared = fromUrl()
    if (shared) loadScenario(shared)
  }, [loadScenario])

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/workloads" element={<WorkloadsPage />} />
        <Route path="/configuration" element={<ConfigurationPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/capacity" element={<CapacityPage />} />
        <Route path="/management-plane" element={<ManagementPlanePage />} />
        <Route path="/method" element={<MethodPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
