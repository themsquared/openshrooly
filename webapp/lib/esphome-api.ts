import { writeTaken } from './light-state'

export interface SensorData {
  id: string
  name: string
  value: number | string
  state: string
  unit?: string
}

export interface DeviceState {
  temperature?: SensorData
  humidity?: SensorData
  water_level?: SensorData
  air_exchange_on?: boolean
  lights_on?: boolean
  white_intensity?: number
}

class ESPHomeAPI {
  private baseUrl: string
  // HTTP status of the last write (0 when the chamber could not be reached). Shown in error messages.
  lastWriteStatus = 0

  constructor() {
    // When running on the device, API is at root
    // When developing locally, you can override this
    this.baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  }

  async getSensor(sensorId: string): Promise<SensorData | null> {
    try {
      const response = await fetch(`${this.baseUrl}/sensor/${sensorId}`)
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      console.error(`Failed to fetch sensor ${sensorId}:`, error)
      return null
    }
  }

  async getSwitch(switchId: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/switch/${switchId}`)
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      console.error(`Failed to fetch switch ${switchId}:`, error)
      return null
    }
  }

  async getNumber(numberId: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/number/${numberId}`)
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      console.error(`Failed to fetch number ${numberId}:`, error)
      return null
    }
  }

  async setNumber(numberId: string, value: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/number/${numberId}/set?value=${value}`, {
        method: 'POST',
      })
      this.lastWriteStatus = response.status
      return response.ok
    } catch (error) {
      console.error(`Failed to set number ${numberId}:`, error)
      this.lastWriteStatus = 0
      return false
    }
  }

  // The chamber answers 200 even when it ignores a number that is out of range,
  // so read the number back and compare before calling the write good.
  async setNumberChecked(
    numberId: string,
    value: number
  ): Promise<{ ok: boolean; actual?: number; reason?: 'rejected' | 'ignored' }> {
    const sent = await this.setNumber(numberId, value)
    if (!sent) return { ok: false, reason: 'rejected' }
    await new Promise((resolve) => setTimeout(resolve, 400))
    const back = await this.getNumber(numberId)
    const actual = back ? Number(back.value) : NaN
    if (!Number.isFinite(actual)) return { ok: true }
    return writeTaken(value, actual, Math.max(0.51, Math.abs(value) * 0.03)) ? { ok: true, actual } : { ok: false, actual, reason: 'ignored' }
  }

  async setSwitch(switchId: string, state: boolean): Promise<boolean> {
    try {
      const action = state ? 'turn_on' : 'turn_off'
      const response = await fetch(`${this.baseUrl}/switch/${switchId}/${action}`, {
        method: 'POST',
      })
      this.lastWriteStatus = response.status
      return response.ok
    } catch (error) {
      console.error(`Failed to set switch ${switchId}:`, error)
      this.lastWriteStatus = 0
      return false
    }
  }

  async getAllSensors(): Promise<DeviceState> {
    try {
      // Fetch all the sensors in parallel
      const [temperature, humidity, waterLevel] = await Promise.all([
        this.getSensor('temperature'),
        this.getSensor('humidity'),
        this.getSensor('water_level_percent'),
      ])

      return {
        temperature: temperature || undefined,
        humidity: humidity || undefined,
        water_level: waterLevel || undefined,
      }
    } catch (error) {
      console.error('Failed to fetch device state:', error)
      return {}
    }
  }

  async getTextSensor(sensorId: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/text_sensor/${sensorId}`)
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      console.error(`Failed to fetch text sensor ${sensorId}:`, error)
      return null
    }
  }

  async getWifiStatus(): Promise<{ mode?: string; ssid?: string; ip?: string }> {
    const [mode, ssid, ip] = await Promise.all([
      this.getTextSensor('wifi_mode'),
      this.getTextSensor('wifi_ssid'),
      this.getTextSensor('ip_address'),
    ])
    return {
      mode: mode?.state || mode?.value,
      ssid: ssid?.state || ssid?.value,
      ip: ip?.state || ip?.value,
    }
  }

  async getGrowCaption(): Promise<{ phase?: string; day?: number; total?: number }> {
    const [phase, day, total] = await Promise.all([
      this.getSelect('grow_phase'),
      this.getNumber('grow_day'),
      this.getNumber('grow_days_total'),
    ])
    return {
      phase: phase?.state || phase?.value,
      day: day?.value != null ? Number(day.value) : undefined,
      total: total?.value != null ? Number(total.value) : undefined,
    }
  }

  async applyWrites(writes: { kind: string; id: string; value: string | number }[]): Promise<boolean> {
    for (const write of writes) {
      const ok =
        write.kind === 'select'
          ? await this.setSelect(write.id, String(write.value))
          : await this.setNumber(write.id, Number(write.value))
      if (!ok) return false
    }
    return true
  }

  async getAllNumbers(): Promise<{ [key: string]: any }> {
    const numberIds = [
      'target_humidity',
      'humidifier__speed',
      'temperature__minimum',
      'temperature__maximum',
      'temperature__target',
      'air_exchange__period__min_',
      'air_exchange__run_duration__s_',
      'air_exchange__speed',
      'lights__sunrise_hour',
      'lights__duration__hours_',
      'white_led_intensity',
      'red_led_intensity',
      'green_led_intensity',
      'blue_led_intensity',
      'grow_day',
      'grow_days_total',
    ]

    try {
      const results = await Promise.all(numberIds.map((id) => this.getNumber(id)))
      const numbers: { [key: string]: any } = {}

      results.forEach((result, index) => {
        if (result) {
          numbers[`number-${numberIds[index]}`] = result
        }
      })

      return numbers
    } catch (error) {
      console.error('Failed to fetch numbers:', error)
      return {}
    }
  }

  // Subscribe to real-time updates via EventSource
  async pressButton(buttonId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/button/${buttonId}/press`, {
        method: 'POST',
      })
      this.lastWriteStatus = response.status
      return response.ok
    } catch (error) {
      console.error(`Failed to press button ${buttonId}:`, error)
      this.lastWriteStatus = 0
      return false
    }
  }

  async getSelect(selectId: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/select/${selectId}`)
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      console.error(`Failed to fetch select ${selectId}:`, error)
      return null
    }
  }

  async setSelect(selectId: string, value: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/select/${selectId}/set?option=${encodeURIComponent(value)}`, {
        method: 'POST',
      })
      this.lastWriteStatus = response.status
      return response.ok
    } catch (error) {
      console.error(`Failed to set select ${selectId}:`, error)
      this.lastWriteStatus = 0
      return false
    }
  }

  subscribeToEvents(onEvent: (event: any) => void, onError?: () => void): EventSource | null {
    try {
      const eventSource = new EventSource(`${this.baseUrl}/events`)

      eventSource.addEventListener('state', (event) => {
        try {
          const data = JSON.parse(event.data)
          // Process all entity updates (sensors, numbers, switches, etc.)
          if (data.id) {
            onEvent(data)
          }
        } catch (error) {
          console.error('Failed to parse event:', error)
        }
      })

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error)
        onError?.()
      }

      return eventSource
    } catch (error) {
      console.error('Failed to create EventSource:', error)
      return null
    }
  }
}

export const api = new ESPHomeAPI()
