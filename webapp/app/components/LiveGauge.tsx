type LiveGaugeProps = {
  label: string
  value: number
  unit: string
  min?: number
  max?: number
  color: string
  target?: number
  detail?: string
  badge?: string
  onClick?: () => void
}

export default function LiveGauge({
  label,
  value,
  unit,
  min = 0,
  max = 100,
  color,
  target,
  detail,
  badge,
  onClick,
}: LiveGaugeProps) {
  const clamped = Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
  const pct = (clamped - min) / (max - min || 1)
  const radius = 46
  const circ = 2 * Math.PI * radius
  const dash = circ * Math.max(0.02, pct)

  return (
    <button type="button" className="gauge" onClick={onClick} style={{ ['--gauge' as string]: color }}>
      {badge && <span className="gauge-badge">{badge}</span>}
      <svg className="gauge-ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="gauge-track" cx="60" cy="60" r={radius} />
        <circle
          className="gauge-arc"
          cx="60"
          cy="60"
          r={radius}
          strokeDasharray={`${dash} ${circ}`}
          strokeDashoffset={circ * 0.25}
        />
      </svg>
      <div className="gauge-readout">
        <div className="gauge-value">
          {Number.isFinite(value) ? (unit === '%' || unit === 'ppm' ? value.toFixed(0) : value.toFixed(1)) : '—'}
          <span className="gauge-unit">{unit}</span>
        </div>
        <div className="gauge-label">{label}</div>
        {detail && <div className="gauge-detail">{detail}</div>}
        {target != null && <div className="gauge-detail">target {target}</div>}
      </div>
    </button>
  )
}
