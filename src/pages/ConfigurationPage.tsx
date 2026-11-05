import { ConfigPanel } from '../components/ConfigPanel'
import { NewPlatformHeader, NewPlatformNav } from '../components/NewPlatformStep'
import { useSurveyorStore } from '../state/store'

/** Refine assumptions: advanced settings after the options. Every change re-runs the options matrix. */
export default function ConfigurationPage() {
  const { cfg, setCfg, tiers, setTiers } = useSurveyorStore()
  return (
    <>
      <NewPlatformHeader
        route="/configuration"
        description="Advanced settings: host reserves, vCPU ratios, CSV layout, SAN data reduction, and your own server or drive layout if you have one in mind. Every change here re-runs the options and the shortlist."
      />
      <ConfigPanel cfg={cfg} setCfg={setCfg} tiers={tiers} setTiers={setTiers} />
      <NewPlatformNav route="/configuration" nextDescription="Turn the selected platform into a management recommendation and deployment bill of materials." />
    </>
  )
}
