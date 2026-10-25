export type GrowPreset = {
  id: string
  label: string
  phase: string
  day: number
  total: number
  setpoints: {
    humidity: number
    temperature: number
    sunrise: number
    lightHours: number
    lux?: number
    red?: number
    green?: number
    blue?: number
  } | null
}

export type DeviceSurface = 'unreachable' | 'first-run-wifi' | 'empty-grow' | 'ready'

export type PresetWrite = { kind: 'select' | 'number'; id: string; value: string | number }

export const GROW_PRESETS: GrowPreset[]

export const DEVICE_VERSION: string
export function connectionLabel(wifiMode?: string): string
export function presetSummary(preset: GrowPreset): string
export function isApMode(wifiMode?: string, ssid?: string): boolean
export function hasActiveGrow(phase?: string, totalDays?: number | string): boolean
export function deviceSurfaceState(input: {
  wifiMode?: string
  ssid?: string
  phase?: string
  totalDays?: number | string
  reachable?: boolean
  lastError?: string
}): DeviceSurface
export function firstRunSteps(state: DeviceSurface): { title: string; body: string; action: string }
export function applyPresetWrites(preset: GrowPreset): PresetWrite[]
export function entityPatchFromWrites(writes: PresetWrite[]): Record<string, { state: string; value: string | number }>
