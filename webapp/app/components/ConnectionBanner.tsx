import { firstRunSteps } from '../../lib/setup-state'
import type { DeviceSurface } from '../../lib/setup-state'

type Props = {
  state: DeviceSurface
  ssid?: string
  onRetry?: () => void
}

export default function ConnectionBanner({ state, ssid, onRetry }: Props) {
  if (state === 'ready' || state === 'empty-grow') return null

  const steps = firstRunSteps(state)
  const tone = state === 'unreachable' ? 'is-alert' : 'is-setup'

  return (
    <aside className={`connection-banner ${tone}`} role="status">
      <div>
        <strong>{steps.title}</strong>
        <p>{steps.body}</p>
        {ssid ? <p className="connection-meta">SSID {ssid}</p> : null}
      </div>
      {state === 'unreachable' && onRetry ? (
        <button type="button" className="charts-button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
      {state === 'first-run-wifi' ? (
        <a className="charts-button" href="/">
          Open Wi-Fi form
        </a>
      ) : null}
    </aside>
  )
}
