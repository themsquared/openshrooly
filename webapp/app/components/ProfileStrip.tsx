type Stage = { id: string; name: string; days: number }

type ProfileStripProps = {
  profile?: string
  stage?: string
  day?: number
  stageDays?: number
  stages?: Stage[]
}

export default function ProfileStrip({ profile, stage, day, stageDays, stages = [] }: ProfileStripProps) {
  if (!profile && (!stage || stage === 'Idle')) {
    return (
      <section className="profile-strip">
        <div>
          <div className="card-label">Current grow</div>
          <div className="profile-name">Idle</div>
          <p className="profile-empty">No grow is running. Pick a culinary stage above. Climate numbers stay on the sliders.</p>
        </div>
      </section>
    )
  }

  const progress = stageDays && day != null ? Math.max(0, Math.min(100, (day / stageDays) * 100)) : 0
  const activeIndex = Math.max(
    0,
    stages.findIndex((item) => item.name.toLowerCase() === String(stage || '').toLowerCase() || item.id === stage)
  )

  return (
    <section className="profile-strip">
      <div>
        <div className="card-label">Current grow</div>
        <div className="profile-name">{profile || stage || 'Untitled'}</div>
        <div className="profile-stage">
          {stage || '—'}
          {day != null && stageDays ? ` · day ${day} of ${stageDays}` : ''}
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
