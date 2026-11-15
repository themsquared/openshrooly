export type Stage = 'Colonization' | 'Pinning' | 'Fruiting' | 'Custom'

export type Recipe = {
  temperature: number
  humidity: number
  sunrise: number
  lightHours: number
  white: number
  red: number
  green: number
  blue: number
  fanSpeed: number
  airPeriodMin: number
  airRunSec: number
}

export const STAGES: readonly Stage[]
export const CARDS: readonly { id: 'temperature' | 'humidity' | 'light' | 'air'; label: string }[]
export const RECIPES: Record<'Colonization' | 'Pinning' | 'Fruiting', Recipe>
export function canonicalStage(name?: string | null): Stage | null
export function missingStages(available: readonly string[]): Stage[]
export function missingStageNote(available: readonly string[]): string
export function recipeFromProfile(stage: string, profileStages?: Record<string, Record<string, number | null>> | null): Recipe | null
