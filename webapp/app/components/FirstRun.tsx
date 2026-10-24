import { GROW_PRESETS, firstRunSteps } from '../../lib/setup-state'
import type { DeviceSurface, GrowPreset } from '../../lib/setup-state'

type Props = {
  state: DeviceSurface
  applying?: boolean
  onApply?: (preset: GrowPreset) => void
}

export default function FirstRun({ state, applying, onApply }: Props) {
  if (state !== 'first-run-wifi' && state !== 'empty-grow') return null

  const steps = firstRunSteps(state)

  return (
    <section className="first-run" aria-labelledby="first-run-title">
      <div className="first-run-copy">
        <div className="card-label">First run</div>
        <h2 id="first-run-title">{steps.title}</h2>
        <p>{steps.body}</p>
        {state === 'first-run-wifi' ? (
          <ol className="first-run-steps">
            <li>Stay on the OpenShrooly network, or open http://192.168.4.1</li>
            <li>Use the captive portal or the ESPHome form at / to join home Wi-Fi</li>
            <li>Come back to this page on the home network and start a grow</li>
          </ol>
        ) : null}
      </div>
      {state === 'empty-grow' ? (
        <div className="preset-grid" role="list">
          {GROW_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="preset-card"
              role="listitem"
              disabled={applying}
              onClick={() => onApply?.(preset)}
            >
              <strong>{preset.label}</strong>
              <span>{preset.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
