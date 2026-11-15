import type { PresetWrite } from './setup-state'

export const STAGES_AVAILABLE: readonly string[]
export const PRESETS_ON_DEVICE: boolean
export const WHITE_UNIT: string
export const FAN_MIN_PERCENT: number
export function nativeStage(stage: string): string | null
export function stageWrites(stage: string, profileStages?: Record<string, Record<string, number | null>> | null): PresetWrite[]
export function currentStage(nativeName?: string | null): string | null
export function whiteDisplay(raw: unknown): number
