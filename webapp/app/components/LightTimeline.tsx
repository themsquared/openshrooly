type LightTimelineProps = {
  sunrise: number
  sunset: number
  nowHour: number
  lightsOn: boolean
  onClick?: () => void
}

function hourLabel(hour: number) {
  const h = Math.floor(((hour % 24) + 24) % 24)
  return `${h.toString().padStart(2, '0')}:00`
}

export default function LightTimeline({ sunrise, sunset, nowHour, lightsOn, onClick }: LightTimelineProps) {
  const wraps = sunrise > sunset
  const nowPct = (nowHour / 24) * 100
  const risePct = (sunrise / 24) * 100
  const setPct = (sunset / 24) * 100

  return (
    <button type="button" className="timeline-card" onClick={onClick}>
      <div className="timeline-head">
        <div>
          <div className="card-label">Light schedule</div>
          <div className="timeline-title">{lightsOn ? 'Photoperiod on' : 'Night cycle'}</div>
        </div>
        <div className="timeline-meta">
          {hourLabel(sunrise)} → {hourLabel(sunset)}
        </div>
      </div>
      <div className="timeline-track" aria-hidden="true">
        {wraps ? (
          <>
            <span className="timeline-on" style={{ left: '0%', width: `${setPct}%` }} />
            <span className="timeline-on" style={{ left: `${risePct}%`, width: `${100 - risePct}%` }} />
          </>
        ) : (
          <span className="timeline-on" style={{ left: `${risePct}%`, width: `${Math.max(2, setPct - risePct)}%` }} />
        )}
        <span className="timeline-now" style={{ left: `${nowPct}%` }} />
      </div>
      <div className="timeline-hours">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </button>
  )
}
