export interface LightSettings {
  sunrise: number
  duration: number
  white: number
  red: number
  green: number
  blue: number
  colorOn: boolean
}
export function numberOr(value: unknown, fallback: number): number
export function lightFromEntities(get: (id: string) => unknown, whiteDefault?: number): LightSettings
export function ringDarkBecauseOfDuration(light: LightSettings): boolean
export function writeTaken(sent: number, actual: unknown, tolerance?: number): boolean
export function writeFailedText(status: number): string
