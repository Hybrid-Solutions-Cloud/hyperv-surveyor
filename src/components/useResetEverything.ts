import { useNavigate } from 'react-router-dom'
import { useSurveyorStore } from '../state/store'

/**
 * Clears every saved value in this browser and returns to the start. A shared link's scenario is
 * also removed from the address, because reloading it would otherwise bring the design back.
 */
export function useResetEverything() {
  const navigate = useNavigate()
  const resetScenario = useSurveyorStore((state) => state.resetScenario)
  const savedScenarioCount = useSurveyorStore((state) => state.savedScenarios.length)

  return () => {
    const scenarios = savedScenarioCount === 0
      ? ''
      : ` This includes ${savedScenarioCount} saved scenario${savedScenarioCount === 1 ? '' : 's'}.`
    const confirmed = window.confirm(`Clear everything and start fresh?\n\nThis removes all workloads, settings, and answers from this browser.${scenarios} It cannot be undone, so download a project file first if you need this design.`)
    if (!confirmed) return
    resetScenario()
    const url = new URL(window.location.href)
    if (url.searchParams.has('s')) {
      url.searchParams.delete('s')
      window.history.replaceState(null, '', url.toString())
    }
    navigate('/')
  }
}
