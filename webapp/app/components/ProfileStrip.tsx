import { useState } from 'react'

type Stage = { id: string; name: string; days: number }

type ProfileStripProps = {
  profile?: string
  stage?: string
  day?: number
  stageDays?: number
  stages?: Stage[]
  /** From shroomlabs.io while the chamber is linked. */
  growName?: string
  growUrl?: string
  growImage?: string
  linked?: boolean
}

const https = (value?: string) => (value && value.startsWith('https://') ? value : '')

export default function ProfileStrip({
  profile,
  stage,
  day,
  stageDays,
  stages = [],
  growName,
  growUrl,
  growImage,
  linked = false,
}: ProfileStripProps) {
  const [imageFailed, setImageFailed] = useState('')
  const name = growName || profile || ''
  const link = growName ? https(growUrl) : ''
  const image = growName ? https(growImage) : ''
  const hint = linked ? 'Pick a mushroom on shroomlabs.io to see its name here.' : ''

  if (!name && (!stage || stage === 'Idle')) {
    return (
      <section className="profile-strip">
        <div>
          <div className="card-label">Current grow</div>
          <div className="profile-name">Nothing picked yet</div>
          <p className="profile-empty">
            No grow is running. Pick a starting point above, or set humidity, temperature, and lights yourself.
            {hint ? ` ${hint}` : ''}
          </p>
        </div>
      </section>
    )
  }

  const progress = stageDays && day != null ? Math.max(0, Math.min(100, (day / stageDays) * 100)) : 0
  const activeIndex = Math.max(
    0,
    stages.findIndex((item) => item.name.toLowerCase() === String(stage || '').toLowerCase() || item.id === stage)
  )
  const stageLine = `${stage || 'Not set'}${day != null && stageDays ? ` · day ${day} of ${stageDays}` : ''}`
  const showImage = Boolean(image) && imageFailed !== image

  return (
    <section className="profile-strip">
      <div className="profile-head">
        {showImage && (
          <img
            className="profile-photo"
            src={image}
            alt=""
            width={64}
            height={64}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(image)}
          />
        )}
        <div className="profile-text">
          <div className="card-label">Current grow</div>
          {name ? (
            <>
              <div className="profile-name">{name}</div>
              <div className="profile-stage">{stageLine}</div>
              {link && (
                <a className="profile-link" href={link} target="_blank" rel="noopener noreferrer">
                  View profile
                </a>
              )}
            </>
          ) : (
            <>
              <div className="profile-name">Grow stage: {stage}</div>
              {day != null && stageDays ? <div className="profile-stage">Day {day} of {stageDays}</div> : null}
              {hint && <p className="profile-empty">{hint}</p>}
            </>
          )}
        </div>
      </div>
      <div className="profile-progress">
        <div className="profile-bar">
          <span style={{ width: `${progress}%` }} />
        </div>
        {stages.length > 0 && (
          <ol className="profile-stages">
            {stages.map((item, index) => (
              <li key={item.id} className={index === activeIndex ? 'is-active' : index < activeIndex ? 'is-done' : ''}>
                {item.name}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
