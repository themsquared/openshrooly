export interface EntityState {
  [key: string]: {
    value: number | string | boolean
    state: string
  }
}
