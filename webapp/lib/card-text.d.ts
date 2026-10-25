export type Sample = { t: number; v: number }
export function hourText(hour: number): string
export function scheduleText(start: number, end: number): string
export function hour24(hour: number): string
export function lightOnSummary(sunrise: number, duration: number): string
export function rangeText(lo: number, hi: number, unit: string): string | null
export function addSample(samples: Sample[], t: number, value: number): Sample[]
export function trendText(samples: Sample[], step: number): string
