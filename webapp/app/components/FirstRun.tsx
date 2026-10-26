import { useState } from 'react'
import { GROW_PRESETS, firstRunSteps, presetSummary } from '../../lib/setup-state'
import type { DeviceSurface, GrowPreset } from '../../lib/setup-state'

type Props = {
  state: DeviceSurface
  applying?: boolean
  onApply?: (preset: GrowPreset) => void
  error?: string
}

export default function FirstRun({ state, applying, onApply, error }: Props) {
  const [picked, setPicked] = useState<GrowPreset | null>(null)

  if (state !== 'first-run-wifi' && state !== 'empty-grow') return null

  const steps = firstRunSteps(state)

  return (
    <section className="first-run" aria-labelledby="first-run-title">
      <div className="first-run-copy">
        <div className="card-label">Getting started</div>
        <h2 id="first-run-title">{steps.title}</h2>
        <p>{steps.body}</p>
        {error ? <p className="first-run-error" role="alert">{error}</p> : null}
        {state === 'first-run-wifi' ? (
          <ol className="first-run-steps">
            <li>On your phone, join the Wi-Fi network shown on the chamber screen, with the password shown there</li>
            <li>Open 192.168.4.1 and choose your home Wi-Fi</li>
            <li>Come back to this page on your home Wi-Fi and start a grow</li>
          </ol>
        ) : null}
      </div>
      {state === 'empty-grow' ? (
        <div className="preset-grid" role="list">
          {GROW_PRESETS.map((preset) => {
            const isPicked = picked?.id === preset.id
            return (
              <div key={preset.id} role="listitem" className={`preset-card${isPicked ? ' is-picked' : ''}`}>
                <button
                  type="button"
                  className="preset-pick"
                  aria-pressed={isPicked}
                  disabled={applying}
                  onClick={() => setPicked(isPicked ? null : preset)}
                >
                  <strong>{preset.label}</strong>
                  <span>{presetSummary(preset)}</span>
                </button>
                {isPicked ? (
                  <div className="preset-confirm">
                    <button
                      type="button"
                      className="charts-button"
                      disabled={applying}
                      onClick={() => onApply?.(preset)}
                    >
                      {applying ? 'Starting…' : 'Start this grow'}
                    </button>
                    <button type="button" className="preset-cancel" disabled={applying} onClick={() => setPicked(null)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
