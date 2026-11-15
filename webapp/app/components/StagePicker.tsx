import { STAGES, missingStageNote } from '../../lib/stage-standard'

type Props = {
  /** Canonical stage the chamber is in now, or null (for example Idle). */
  current: string | null
  /** Canonical stages this chamber has. The rest show disabled, with one note line. */
  available: readonly string[]
  busy?: boolean
  error?: string
  onPick: (stage: string) => void
}

/** The same four stages on every chamber. Picking one loads that stage's Temp, Humidity, Light and Fresh air. */
export default function StagePicker({ current, available, busy, error, onPick }: Props) {
  const note = missingStageNote(available)
  return (
    <section className="stage-picker" aria-label="Stage">
      <div className="card-label">Stage</div>
      <div className="stage-picker-row" role="group" aria-label="Stage">
        {STAGES.map((stage) => {
          const has = available.includes(stage)
          const isCurrent = current === stage
          return (
            <button
              key={stage}
              type="button"
              className={`stage-pick${isCurrent ? ' is-current' : ''}`}
              aria-pressed={isCurrent}
              disabled={!has || busy}
              onClick={() => onPick(stage)}
            >
              {stage}
            </button>
          )
        })}
      </div>
      {note ? <p className="stage-picker-note">{note}</p> : null}
      {error ? <p className="stage-picker-error" role="alert">{error}</p> : null}
    </section>
  )
}
