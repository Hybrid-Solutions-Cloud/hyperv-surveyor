import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import HomePage from './pages/HomePage'
import WorkloadsPage from './pages/WorkloadsPage'
import ConfigurationPage from './pages/ConfigurationPage'
import ResultsPage from './pages/ResultsPage'
import DataCheckPage from './pages/DataCheckPage'
import GoalsPage from './pages/GoalsPage'
import ShortlistPage from './pages/ShortlistPage'
import WhatToBuyPage from './pages/WhatToBuyPage'
import CapacityPage from './pages/CapacityPage'
import ManagementPlanePage from './pages/ManagementPlanePage'
import MethodPage from './pages/MethodPage'
import ReportPage from './pages/ReportPage'
import ProjectPage from './pages/ProjectPage'
import DeploymentPage from './pages/DeploymentPage'
import AboutPage from './pages/AboutPage'

/** Shared links are applied in main.tsx, after saved state loads and before this renders. */
export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/workloads" element={<WorkloadsPage />} />
        <Route path="/configuration" element={<ConfigurationPage />} />
        <Route path="/data-check" element={<DataCheckPage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/shortlist" element={<ShortlistPage />} />
        <Route path="/what-to-buy" element={<WhatToBuyPage />} />
        <Route path="/capacity" element={<CapacityPage />} />
        <Route path="/management-plane" element={<ManagementPlanePage />} />
        <Route path="/deployment" element={<DeploymentPage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/project" element={<ProjectPage />} />
        <Route path="/method" element={<MethodPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
