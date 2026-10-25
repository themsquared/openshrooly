'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '../lib/esphome-api'
import {
  applyPresetWrites,
  deviceSurfaceState,
  entityPatchFromWrites,
} from '../lib/setup-state'
import { DEVICE_VERSION, connectionLabel } from '../lib/setup-state'
import type { GrowPreset } from '../lib/setup-state'
import { addSample, lightOnSummary, rangeText, scheduleText, trendText } from '../lib/card-text'
import type { Sample } from '../lib/card-text'
import Icon from './components/Icon'
import LiveGauge from './components/LiveGauge'
import LightTimeline from './components/LightTimeline'
import ProfileStrip from './components/ProfileStrip'
import ConnectionBanner from './components/ConnectionBanner'
import FirstRun from './components/FirstRun'
import CloudSettings from './components/CloudSettings'
import { DEMO_ENTITIES, DEMO_STAGES } from './demo-entities'
import type { EntityState } from './entity-types'

interface ModalState {
  type: 'humidity' | 'temperature' | 'air' | 'light' | 'water' | 'settings' | 'calibrate' | null
}

export default function Dashboard() {
  const [entities, setEntities] = useState<EntityState>({})
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [tempSamples, setTempSamples] = useState<Sample[]>([])
  const [humiditySamples, setHumiditySamples] = useState<Sample[]>([])
  const [modal, setModal] = useState<ModalState>({ type: null })
  const [timezone, setTimezone] = useState<string>('')
  const [timezoneOptions, setTimezoneOptions] = useState<string[]>([])
  const [timezoneUpdating, setTimezoneUpdating] = useState(false)
  const [timezoneError, setTimezoneError] = useState('')
  const [flipScreen, setFlipScreen] = useState(false)
  const [calibrationSuccess, setCalibrationSuccess] = useState(false)
  const [calibrationBusy, setCalibrationBusy] = useState(false)
  const [calibrationError, setCalibrationError] = useState('')
  const [lightSunrise, setLightSunrise] = useState<number>(8)
  const [lightSunset, setLightSunset] = useState<number>(20)
  const [lightDuration, setLightDuration] = useState<number>(12)
  const [luxValue, setLuxValue] = useState<number>(150)
  const [draggingHandle, setDraggingHandle] = useState<'sunrise' | 'sunset' | null>(null)
  const [draggingHumidityHandle, setDraggingHumidityHandle] = useState<'target' | 'lower' | 'upper' | null>(null)
  const [draggingTempHandle, setDraggingTempHandle] = useState<'target' | 'lower' | 'upper' | null>(null)
  const [showLicense, setShowLicense] = useState(false)
  const [otaFile, setOtaFile] = useState<File | null>(null)
  const [otaProgress, setOtaProgress] = useState<number>(0)
  const [otaStatus, setOtaStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [otaMessage, setOtaMessage] = useState<string>('')
  const [updateRequestError, setUpdateRequestError] = useState<string>('')
  const [demoMode, setDemoMode] = useState(false)
  const [reachable, setReachable] = useState<boolean | undefined>(undefined)
  const [lastError, setLastError] = useState('')
  const [applyingPreset, setApplyingPreset] = useState(false)
  const [wifiMode, setWifiMode] = useState('')
  const [wifiSsid, setWifiSsid] = useState('')

  // Track humidity values during drag to avoid stale state issues
  const humidityDragValues = useRef<{ target: number; hysteresis: number }>({ target: 70, hysteresis: 2 })
  const tempDragValues = useRef<{ target: number; hysteresis: number }>({ target: 22, hysteresis: 1 })
  const debounceTimers = useRef<{ [key: string]: NodeJS.Timeout }>({})

  useEffect(() => {
    const isDemo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')
    if (isDemo) {
      setDemoMode(true)
      setEntities(DEMO_ENTITIES)
      setReachable(true)
      setLastError('')
      setLoading(false)
      return
    }

    const fetchData = async () => {
      let ok = false
      try {
        const numbers = await api.getAllNumbers()
        if (Object.keys(numbers).length) {
          setEntities((prev) => ({ ...prev, ...numbers }))
          ok = true
        }
      } catch (e) {
        setLastError('Could not read the chamber settings')
      }

      try {
        const grow = await api.getGrowCaption()
        setEntities((prev) => ({
          ...prev,
          ...(grow.phase ? { 'select-grow_phase': { state: grow.phase, value: grow.phase } } : {}),
          ...(grow.day != null ? { 'number-grow_day': { state: String(grow.day), value: grow.day } } : {}),
          ...(grow.total != null ? { 'number-grow_days_total': { state: String(grow.total), value: grow.total } } : {}),
        }))
        if (grow.phase || grow.day != null) ok = true
      } catch (e) {
        // Caption is optional until Ship 5a firmware is flashed
      }

      try {
        const wifi = await api.getWifiStatus()
        if (wifi.mode) setWifiMode(String(wifi.mode))
        if (wifi.ssid) setWifiSsid(String(wifi.ssid))
        setEntities((prev) => ({
          ...prev,
          ...(wifi.mode ? { 'text_sensor-wifi_mode': { state: wifi.mode, value: wifi.mode } } : {}),
          ...(wifi.ssid ? { 'text_sensor-wifi_ssid': { state: wifi.ssid, value: wifi.ssid } } : {}),
          ...(wifi.ip ? { 'text_sensor-ip_address': { state: wifi.ip, value: wifi.ip } } : {}),
        }))
        if (wifi.mode || wifi.ssid) ok = true
      } catch (e) {
        // Wi-Fi text sensors still arrive over /events
      }

      try {
        const tz = await api.getSelect('timezone')
        if (tz?.state) {
          setTimezone(tz.state)
          ok = true
        }
      } catch (e) {
        // Ignore errors during initial fetch - EventSource will populate data
      }

      try {
        const flip = await api.getSwitch('flip_screen')
        if (flip) {
          setFlipScreen(flip.state === 'ON' || flip.value === true)
          ok = true
        }
      } catch (e) {
        // Ignore errors during initial fetch - EventSource will populate data
      }

      setReachable(ok)
      if (!ok) setLastError((prev) => prev || 'Cannot reach the chamber')
      else setLastError('')
      setLoading(false)
    }

    fetchData()

    const handleEvent = (event: any) => {
      if (event.id) {
        setReachable(true)
        setLastError('')
        setEntities((prev) => ({
          ...prev,
          [event.id]: {
            value: event.value !== undefined ? event.value : event.state === 'ON',
            state: event.state,
          },
        }))
        setLastUpdate(new Date())

        // Update timezone from events
        if (event.id === 'select-timezone') {
          setTimezone(event.state)
          setTimezoneError('')
          if (Array.isArray(event.option)) {
            setTimezoneOptions(event.option)
          }
        }
        if (event.id === 'switch-flip_screen') {
          setFlipScreen(event.state === 'ON' || event.value === true)
        }
        if (event.id === 'text_sensor-wifi_mode' && event.state) setWifiMode(event.state)
        if (event.id === 'text_sensor-wifi_ssid' && event.state) setWifiSsid(event.state)
        if (event.id === 'select-grow_phase' || event.id === 'number-grow_day' || event.id === 'number-grow_days_total') {
          setReachable(true)
          setLastError('')
        }
      }
    }

    let eventSource: EventSource | null = null

    const disconnectEvents = () => {
      eventSource?.close()
      eventSource = null
    }

    const connectEvents = () => {
      if (document.visibilityState === 'visible' && !eventSource) {
        eventSource = api.subscribeToEvents(handleEvent, () => {
          setReachable((prev) => (prev === true ? prev : false))
          setLastError((prev) => prev || 'Lost the live connection')
        })
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        connectEvents()
      } else {
        disconnectEvents()
      }
    }

    connectEvents()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', disconnectEvents)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', disconnectEvents)
      disconnectEvents()
      Object.values(debounceTimers.current).forEach((timer) => clearTimeout(timer))
    }
  }, [])

  const applyPreset = async (preset: GrowPreset) => {
    if (applyingPreset) return
    setApplyingPreset(true)
    const writes = applyPresetWrites(preset)
    const ok = demoMode ? true : await api.applyWrites(writes)
    if (ok) {
      setEntities((prev) => ({ ...prev, ...entityPatchFromWrites(writes) }))
      setLastError('')
      setReachable(true)
    } else {
      setLastError('The chamber did not accept the new grow. Try again.')
    }
    setApplyingPreset(false)
  }

  const handleNumberChange = useCallback((id: string, value: number) => {
    setEntities((prev) => ({
      ...prev,
      [id]: { ...prev[id], value: value },
    }))

    if (debounceTimers.current[id]) {
      clearTimeout(debounceTimers.current[id])
    }

    debounceTimers.current[id] = setTimeout(async () => {
      const numberId = id.replace('number-', '')
      await api.setNumber(numberId, value)
    }, 300)
  }, [])

  const runWaterCalibration = async () => {
    if (calibrationBusy) return

    setCalibrationBusy(true)
    setCalibrationError('')

    try {
      await api.pressButton('cancel_calibration')
      const warningAccepted = await api.pressButton('calibrate_dry_tank')
      if (!warningAccepted) throw new Error('Could not start calibration')

      await new Promise((resolve) => setTimeout(resolve, 500))

      const calibrated = await api.pressButton('calibrate_dry_tank')
      if (!calibrated) throw new Error('Could not save calibration')

      setEntities((prev) => ({
        ...prev,
        'binary_sensor-water_calibrated': { value: true, state: 'ON' },
      }))
      setCalibrationSuccess(true)
      setTimeout(() => setCalibrationSuccess(false), 10000)
      setModal({ type: 'water' })
    } catch (error) {
      setCalibrationError(error instanceof Error ? error.message : 'Calibration failed')
    } finally {
      setCalibrationBusy(false)
    }
  }

  const resetWaterCalibration = async () => {
    setCalibrationError('')
    const reset = await api.pressButton('reset_water_calibration')
    if (!reset) {
      setCalibrationError('Could not reset calibration')
      return
    }

    setCalibrationSuccess(false)
    setEntities((prev) => ({
      ...prev,
      'binary_sensor-water_calibrated': { value: false, state: 'OFF' },
    }))
  }

  const handleSwitchChange = async (id: string, checked: boolean) => {
    setEntities((prev) => ({
      ...prev,
      [id]: { ...prev[id], state: checked ? 'ON' : 'OFF', value: checked },
    }))

    const switchId = id.replace('switch-', '')
    await api.setSwitch(switchId, checked)
  }

  const handleTimezoneChange = async (tz: string) => {
    setTimezoneUpdating(true)
    setTimezoneError('')

    const updated = await api.setSelect('timezone', tz)
    if (!updated) {
      setTimezoneError('The device did not accept the timezone change. Please try again.')
      setTimezoneUpdating(false)
      return
    }

    // The device applies select calls on its main loop after acknowledging the
    // request. Read the authoritative state back instead of assuming success.
    await new Promise((resolve) => setTimeout(resolve, 100))
    const confirmed = await api.getSelect('timezone')
    if (confirmed?.state) {
      setTimezone(confirmed.state)
      if (confirmed.state !== tz) {
        setTimezoneError(`The device kept ${confirmed.state}; ${tz} was not applied.`)
      }
    } else {
      setTimezoneError('The timezone changed, but its confirmed state could not be read.')
    }

    setTimezoneUpdating(false)
  }

  const handleFlipScreenChange = async (flipped: boolean) => {
    setFlipScreen(flipped)
    await api.setSwitch('flip_screen', flipped)
  }

  const updateState = entities['text_sensor-update_state']?.state || 'idle'
  const updateBusy = ['checking', 'downloading', 'verifying', 'restarting'].includes(updateState)
  const updateStatus = updateRequestError || entities['text_sensor-update_status']?.state || 'Not checked yet.'
  const availableVersion = entities['text_sensor-available_version']?.state || ''
  const installedVersion = entities['text_sensor-installed_version']?.state || DEVICE_VERSION
  const allowOlder = entities['switch-allow_older_versions']?.state === 'ON'
  const updateProgress = Number((updateStatus.match(/(\d{1,3})%/) || [])[1] || 0)

  const handleCheckForUpdate = async () => {
    setUpdateRequestError('')
    const ok = await api.pressButton('check_for_update')
    if (!ok) setUpdateRequestError('Could not reach your Shrooly. Try again.')
  }

  const handleInstallUpdate = async () => {
    setUpdateRequestError('')
    const ok = await api.pressButton('install_update')
    if (!ok) setUpdateRequestError('Could not reach your Shrooly. Try again.')
  }

  const handleAllowOlderChange = async (allow: boolean) => {
    setUpdateRequestError('')
    const ok = await api.setSwitch('allow_older_versions', allow)
    if (!ok) setUpdateRequestError('Could not change that setting. Try again.')
  }

  const handleOtaUpload = async () => {
    if (!otaFile) {
      setOtaMessage('Choose an update file first')
      setOtaStatus('error')
      return
    }

    setOtaStatus('uploading')
    setOtaProgress(0)
    setOtaMessage('Sending the update. Keep this page open.')

    try {
      const formData = new FormData()
      formData.append('file', otaFile)

      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100
          setOtaProgress(percentComplete)
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          setOtaStatus('success')
          setOtaMessage('Update installed. The chamber is restarting.')
          setOtaProgress(100)
          setTimeout(() => {
            setOtaStatus('idle')
            setOtaFile(null)
            setOtaProgress(0)
            setOtaMessage('')
          }, 5000)
        } else {
          setOtaStatus('error')
          setOtaMessage('The chamber did not accept this file. Only signed Shroom Labs releases (files ending in .signed.bin) can be installed here.')
        }
      })

      xhr.addEventListener('error', () => {
        setOtaStatus('error')
        setOtaMessage('Lost the connection to the chamber. Try again.')
      })

      xhr.open('POST', '/update')
      xhr.send(formData)
    } catch (error) {
      setOtaStatus('error')
      setOtaMessage('Something went wrong sending the update. Try again.')
    }
  }

  // Convert RGB 0-100 to hex color
  const rgbToHex = (r: number, g: number, b: number) => {
    const toHex = (n: number) => {
      const hex = Math.round((n / 100) * 255).toString(16)
      return hex.length === 1 ? '0' + hex : hex
    }
    return '#' + toHex(r) + toHex(g) + toHex(b)
  }

  // Convert hex color to RGB 0-100
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result
      ? {
          r: Math.round((parseInt(result[1], 16) / 255) * 100),
          g: Math.round((parseInt(result[2], 16) / 255) * 100),
          b: Math.round((parseInt(result[3], 16) / 255) * 100),
        }
      : { r: 0, g: 0, b: 0 }
  }

  const handleColorChange = (hex: string) => {
    const rgb = hexToRgb(hex)
    handleNumberChange('number-red_led_intensity', rgb.r)
    handleNumberChange('number-green_led_intensity', rgb.g)
    handleNumberChange('number-blue_led_intensity', rgb.b)
    if ((rgb.r > 0 || rgb.g > 0 || rgb.b > 0) && !(lightDuration > 0)) {
      handleDurationChange(12)
    }
  }

  // Helper to get values
  const getSensor = (id: string) => entities[`sensor-${id}`]?.value
  const getNumber = (id: string) => entities[`number-${id}`]?.value

  // Keep the last few minutes of readings so the cards can say rising or falling.
  useEffect(() => {
    const t = Date.now()
    setTempSamples((s) => addSample(s, t, parseFloat(getSensor('temperature') as string)))
    setHumiditySamples((s) => addSample(s, t, parseFloat(getSensor('humidity') as string)))
  }, [entities])

  // Sync lighting state from entities
  useEffect(() => {
    const sunrise = parseFloat((getNumber('lights__sunrise_hour') || 8) as string)
    let duration = parseFloat((getNumber('lights__duration__hours_') || 12) as string)
    const lux = parseFloat((getNumber('white_led_intensity') || 150) as string)
    const rgbOn =
      parseFloat((getNumber('red_led_intensity') || 0) as string) > 0 ||
      parseFloat((getNumber('green_led_intensity') || 0) as string) > 0 ||
      parseFloat((getNumber('blue_led_intensity') || 0) as string) > 0
    if ((lux > 0 || rgbOn) && !(duration > 0)) {
      duration = 12
      handleNumberChange('number-lights__duration__hours_', 12)
    }

    setLightSunrise(sunrise)
    setLightDuration(duration)
    setLightSunset((sunrise + duration) % 24)
    setLuxValue(lux)
  }, [entities])

  const timeOptions = Array.from({ length: 48 }, (_, i) => i * 0.5)

  // Lux value helpers - logarithmic scale where 0-1000 lux is half the slider
  const luxToSlider = (lux: number) => {
    if (lux <= 0) return 0
    // Use a custom scale where 1000 lux = 50% slider position
    // log base chosen so that at 50%, we get 1000 lux
    // At slider=50: lux = base^50 - 1 = 1000, so base^50 = 1001, base = 1001^(1/50)
    const base = Math.pow(1001, 1/50)
    // For max 4000 lux at slider=100: 4001 = base^100, so we scale accordingly
    const maxLux = 4000
    const scaledSlider = (Math.log(lux + 1) / Math.log(base))
    // Scale to match 4000 lux at position 100
    return Math.min(100, scaledSlider * (100 / Math.log(maxLux + 1) * Math.log(base)))
  }

  const sliderToLux = (slider: number) => {
    // Inverse: if slider=50 should give 1000 lux
    const base = Math.pow(1001, 1/50)
    const maxLux = 4000
    const scaleFactor = 100 / Math.log(maxLux + 1) * Math.log(base)
    const actualPosition = slider / scaleFactor
    return Math.round(Math.pow(base, actualPosition) - 1)
  }

  const handleSunriseChange = (newSunrise: number) => {
    setLightSunrise(newSunrise)
    setLightSunset((newSunrise + lightDuration) % 24)
    handleNumberChange('number-lights__sunrise_hour', newSunrise)
  }

  const handleSunsetChange = (newSunset: number) => {
    setLightSunset(newSunset)
    const duration = newSunset >= lightSunrise ? newSunset - lightSunrise : (24 - lightSunrise) + newSunset
    setLightDuration(duration)
    handleNumberChange('number-lights__duration__hours_', duration)
  }

  const handleDurationChange = (newDuration: number) => {
    const rgbOn =
      parseFloat((getNumber('red_led_intensity') || 0) as string) > 0 ||
      parseFloat((getNumber('green_led_intensity') || 0) as string) > 0 ||
      parseFloat((getNumber('blue_led_intensity') || 0) as string) > 0
    const lightOn = luxValue > 0 || rgbOn
    // Clamp duration between 0 and 24. When the light is on, 0 is not a valid photoperiod.
    const floor = lightOn ? 0.25 : 0
    const clampedDuration = Math.max(floor, Math.min(24, newDuration))
    setLightDuration(clampedDuration)

    // Calculate sunset, handling wrap around midnight
    let newSunset = lightSunrise + clampedDuration
    if (newSunset >= 24) {
      newSunset = newSunset % 24
    }
    // Round to nearest 0.25 hour (15 min) to match dropdown options
    newSunset = Math.round(newSunset * 4) / 4
    setLightSunset(newSunset)

    handleNumberChange('number-lights__duration__hours_', clampedDuration)
  }

  const handleLuxChange = (sliderValue: number) => {
    const lux = sliderToLux(sliderValue)
    setLuxValue(lux)
    handleNumberChange('number-white_led_intensity', lux)
    if (lux > 0 && !(lightDuration > 0)) {
      handleDurationChange(12)
    }
  }

  // Common function to get position from mouse or touch event
  const getClientX = (e: MouseEvent | TouchEvent): number => {
    return 'touches' in e ? e.touches[0].clientX : e.clientX
  }

  // Common handler for light schedule slider movement
  const handleLightSliderMove = (e: MouseEvent | TouchEvent) => {
    if (!draggingHandle) return

    const track = document.querySelector('.dual-slider-track') as HTMLDivElement
    if (track) {
      const rect = track.getBoundingClientRect()
      const x = Math.max(0, Math.min(getClientX(e) - rect.left, rect.width))
      const percentage = x / rect.width
      const hour = Math.round(percentage * 24 * 4) / 4 // Round to 0.25 increments (15 min)

      if (draggingHandle === 'sunrise') {
        handleSunriseChange(hour)
      } else {
        handleSunsetChange(hour)
      }
    }
  }

  // Common handler for humidity slider movement
  const handleHumiditySliderMove = (e: MouseEvent | TouchEvent) => {
    if (!draggingHumidityHandle) return

    const track = document.querySelector('.humidity-slider-track') as HTMLDivElement
    if (track) {
      const rect = track.getBoundingClientRect()
      const x = Math.max(0, Math.min(getClientX(e) - rect.left, rect.width))
      const percentage = x / rect.width
      const humidity = 60 + (percentage * 40) // Map 0-100% of slider to 60-100% humidity
      const roundedHumidity = Math.round(humidity * 2) / 2 // Round to 0.5%

      const currentTarget = humidityDragValues.current.target
      const currentHyst = humidityDragValues.current.hysteresis

      if (draggingHumidityHandle === 'target') {
        const clampedTarget = Math.max(60 + currentHyst, Math.min(100 - currentHyst, roundedHumidity))
        humidityDragValues.current.target = clampedTarget
        handleNumberChange('number-target_humidity', clampedTarget)
      } else if (draggingHumidityHandle === 'lower') {
        if (roundedHumidity > currentTarget) return
        const newHyst = Math.min(5, (currentTarget - roundedHumidity) / 2)
        const roundedHyst = newHyst < 0.125 ? 0 : Math.round(newHyst * 4) / 4
        humidityDragValues.current.hysteresis = roundedHyst
        handleNumberChange('number-humidity__hysteresis', roundedHyst)
      } else if (draggingHumidityHandle === 'upper') {
        if (roundedHumidity < currentTarget) return
        const newHyst = Math.min(5, (roundedHumidity - currentTarget) / 2)
        const roundedHyst = newHyst < 0.125 ? 0 : Math.round(newHyst * 4) / 4
        humidityDragValues.current.hysteresis = roundedHyst
        handleNumberChange('number-humidity__hysteresis', roundedHyst)
      }
    }
  }

  // Common handler for temperature slider movement
  const handleTempSliderMove = (e: MouseEvent | TouchEvent) => {
    if (!draggingTempHandle) return

    const track = document.querySelector('.temperature-slider-track') as HTMLDivElement
    if (track) {
      const rect = track.getBoundingClientRect()
      const x = Math.max(0, Math.min(getClientX(e) - rect.left, rect.width))
      const percentage = x / rect.width
      const temp = 15 + (percentage * 20) // Map 0-100% of slider to 15-35°C
      const roundedTemp = Math.round(temp * 2) / 2 // Round to 0.5°C

      const currentTarget = tempDragValues.current.target
      const currentHyst = tempDragValues.current.hysteresis

      if (draggingTempHandle === 'target') {
        const clampedTarget = Math.max(15 + currentHyst, Math.min(35 - currentHyst, roundedTemp))
        tempDragValues.current.target = clampedTarget
        handleNumberChange('number-temperature__target', clampedTarget)
      } else if (draggingTempHandle === 'lower') {
        if (roundedTemp > currentTarget) return
        const newHyst = Math.min(3, currentTarget - roundedTemp)
        const roundedHyst = newHyst < 0.125 ? 0 : Math.round(newHyst * 4) / 4
        tempDragValues.current.hysteresis = roundedHyst
        handleNumberChange('number-temperature__hysteresis', roundedHyst)
      } else if (draggingTempHandle === 'upper') {
        if (roundedTemp < currentTarget) return
        const newHyst = Math.min(3, roundedTemp - currentTarget)
        const roundedHyst = newHyst < 0.125 ? 0 : Math.round(newHyst * 4) / 4
        tempDragValues.current.hysteresis = roundedHyst
        handleNumberChange('number-temperature__hysteresis', roundedHyst)
      }
    }
  }

  const handleSliderDrag = useCallback((e: React.MouseEvent, trackRef: HTMLDivElement) => {
    if (!draggingHandle) return

    const rect = trackRef.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const percentage = x / rect.width
    const hour = Math.round(percentage * 24 * 4) / 4 // Round to 0.25 increments (15 min)

    if (draggingHandle === 'sunrise') {
      handleSunriseChange(hour)
    } else {
      handleSunsetChange(hour)
    }
  }, [draggingHandle])

  useEffect(() => {
    const handleEnd = () => setDraggingHandle(null)

    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('mousemove', handleLightSliderMove)
    document.addEventListener('touchend', handleEnd)
    document.addEventListener('touchmove', handleLightSliderMove)
    return () => {
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('mousemove', handleLightSliderMove)
      document.removeEventListener('touchend', handleEnd)
      document.removeEventListener('touchmove', handleLightSliderMove)
    }
  }, [draggingHandle])

  // Humidity slider drag handling
  useEffect(() => {
    const handleEnd = () => setDraggingHumidityHandle(null)

    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('mousemove', handleHumiditySliderMove)
    document.addEventListener('touchend', handleEnd)
    document.addEventListener('touchmove', handleHumiditySliderMove)
    return () => {
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('mousemove', handleHumiditySliderMove)
      document.removeEventListener('touchend', handleEnd)
      document.removeEventListener('touchmove', handleHumiditySliderMove)
    }
  }, [draggingHumidityHandle])

  // Temperature slider drag handling
  useEffect(() => {
    const handleEnd = () => setDraggingTempHandle(null)

    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('mousemove', handleTempSliderMove)
    document.addEventListener('touchend', handleEnd)
    document.addEventListener('touchmove', handleTempSliderMove)
    return () => {
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('mousemove', handleTempSliderMove)
      document.removeEventListener('touchend', handleEnd)
      document.removeEventListener('touchmove', handleTempSliderMove)
    }
  }, [draggingTempHandle])

  // Helper to get alert values
  const getAlert = (id: string) => entities[`binary_sensor-alert__${id}`]?.value === true

  const growPhase = String(entities['select-grow_phase']?.state || entities['select-grow_phase']?.value || '')
  const growDayValue = parseFloat((getNumber('grow_day') || getSensor('grow_day') || '') as string)
  const growTotalValue = parseFloat((getNumber('grow_days_total') || getSensor('stage_days') || '') as string)
  const wifiModeValue = wifiMode || String(entities['text_sensor-wifi_mode']?.state || '')
  const wifiSsidValue = wifiSsid || String(entities['text_sensor-wifi_ssid']?.state || '')
  const surface = demoMode
    ? 'ready'
    : deviceSurfaceState({
        wifiMode: wifiModeValue,
        ssid: wifiSsidValue,
        phase: growPhase,
        totalDays: growTotalValue,
        reachable,
        lastError,
      })

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <div>Connecting to chamber…</div>
      </div>
    )
  }

  if (surface === 'unreachable') {
    return (
      <div className="dashboard">
        <div className="loading-screen">
          <ConnectionBanner
            state="unreachable"
            ssid={wifiSsidValue}
            onRetry={() => window.location.reload()}
          />
        </div>
      </div>
    )
  }

  // Check for active alerts
  const alerts = [
    { id: 'humidity_control_failure', msg: 'Humidity has not risen after 10 minutes' },
    { id: 'i2c_communication_failure', msg: 'Sensor communication error' },
    { id: 'fan_start_failure', msg: 'Fan failed to start' },
    { id: 'temperature_too_low', msg: 'Temperature too low' },
    { id: 'temperature_too_high', msg: 'Temperature too high' },
  ].filter((a) => getAlert(a.id))

  const temp = parseFloat((getSensor('temperature') || getSensor('current_temperature') || 0) as string) || 0
  const humidity = parseFloat((getSensor('humidity') || getSensor('current_humidity') || 0) as string) || 0
  const tempRange = rangeText(
    parseFloat(getSensor('temperature_low_today') as string),
    parseFloat(getSensor('temperature_high_today') as string),
    '°',
  )
  const humidityRange = rangeText(
    parseFloat(getSensor('humidity_low_today') as string),
    parseFloat(getSensor('humidity_high_today') as string),
    '%',
  )
  const waterLevel = parseFloat((getSensor('water_level_percent') || getSensor('water_level') || 0) as string) || 0
  const targetHumidity = parseFloat((getNumber('target_humidity') || 0) as string) || 0
  const co2Raw = getSensor('co2') ?? getSensor('co2_ppm') ?? getSensor('carbon_dioxide')
  const co2 = co2Raw == null || co2Raw === '' ? null : parseFloat(co2Raw as string)
  const profileName = String(entities['text_sensor-current_profile']?.state || entities['text_sensor-current_profile']?.value || '')
  const stageName = growPhase || String(entities['text_sensor-current_stage']?.state || entities['text_sensor-current_stage']?.value || '')
  const growDay = growDayValue
  const stageDays = growTotalValue

  // Temperature control values
  const tempControlEnabled = entities['switch-temperature_control_enabled']?.state === 'ON' || entities['switch-temperature_control_enabled']?.value === true
  const tempTarget = parseFloat((getNumber('temperature__target') || 0) as string) || 0
  const tempHysteresis = parseFloat((getNumber('temperature__hysteresis') || 0) as string) || 0
  const tempMin = tempControlEnabled ? tempTarget - tempHysteresis : 0
  const tempMax = tempControlEnabled ? tempTarget + tempHysteresis : 0

  // Calculate status indicators
  const tempInRange = tempControlEnabled ? (temp >= tempMin && temp <= tempMax) : true
  const humidityInRange = Math.abs(humidity - targetHumidity) <= 2

  // Get device on/off states
  const humidifierOn = entities['switch-humidifier']?.state === 'ON' || entities['binary_sensor-humidifier_on']?.value === true
  const airExchangeOn = entities['switch-air_exchange']?.state === 'ON' || entities['binary_sensor-air_exchange_on']?.value === true
  const isWaterCalibrated = entities['binary_sensor-water_calibrated']?.state === 'ON' || entities['binary_sensor-water_calibrated']?.value === true
  const heatRequested = entities['binary_sensor-heat_requested']?.state === 'ON' || entities['binary_sensor-heat_requested']?.value === true

  // Calculate if lights are on based on schedule
  const now = new Date()
  const currentHour = now.getHours() + now.getMinutes() / 60
  const lightsOn =
    lightSunrise < lightSunset
      ? currentHour >= lightSunrise && currentHour < lightSunset
      : currentHour >= lightSunrise || currentHour < lightSunset

  // Get current RGB values for color picker
  const redValue = parseFloat((getNumber('red_led_intensity') || 0) as string) || 0
  const greenValue = parseFloat((getNumber('green_led_intensity') || 0) as string) || 0
  const blueValue = parseFloat((getNumber('blue_led_intensity') || 0) as string) || 0
  const currentColor = rgbToHex(redValue, greenValue, blueValue)
  const lightEnabled = luxValue > 0 || redValue > 0 || greenValue > 0 || blueValue > 0
  const durationRequired = lightEnabled && !(lightDuration > 0)

  return (
    <div className="dashboard">
      {/* Header */}
      <div className="header-bar">
        <h1>
          <svg
            className="brand-mark"
            width="28"
            height="28"
            viewBox="0 0 28 28"
            aria-hidden="true"
            style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '10px', color: 'var(--sl-spore)' }}
          >
            <path d="M6 16h16l2-2-3-6-7-4-7 4-3 6z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M11 16l-1.5 6 2.5 2.4h4l2.3-2.5L16.8 16" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span>
            <span className="brand-name">Shroom Labs</span>
            <span className="brand-sub">Works with Shrooly devices running OpenShrooly</span>
          </span>
        </h1>
        <div className="header-right">
          {demoMode && <span className="demo-chip">Demo</span>}
          {surface === 'first-run-wifi' && <span className="demo-chip">Setup</span>}
          <span className={`live-dot${surface === 'first-run-wifi' ? ' is-setup' : ''}`} aria-hidden="true" />
          <div className="header-time">{lastUpdate.toLocaleTimeString()}</div>
        </div>
      </div>

      <ConnectionBanner
        state={surface}
        ssid={wifiSsidValue}
        onRetry={() => window.location.reload()}
      />

      <FirstRun state={surface} applying={applyingPreset} onApply={applyPreset} error={lastError} />

      {alerts.length > 0 && (
        <div className="alerts-banner">
          {alerts.map((alert) => (
            <div key={alert.id} className="alert-item">
              ⚠️ {alert.msg}
            </div>
          ))}
        </div>
      )}

      <div className="hero-gauges">
        <LiveGauge
          label="Humidity"
          value={humidity}
          unit="%"
          min={40}
          max={100}
          color="var(--sl-humid)"
          target={targetHumidity}
          badge={humidifierOn ? 'humidifying' : undefined}
          onClick={() => setModal({ type: 'humidity' })}
        />
        <LiveGauge
          label="Temperature"
          value={temp}
          unit="°C"
          min={10}
          max={35}
          color="var(--sl-heat)"
          target={tempControlEnabled ? tempTarget : undefined}
          badge={heatRequested ? 'heating' : undefined}
          onClick={() => setModal({ type: 'temperature' })}
        />
        {co2 != null && !Number.isNaN(co2) ? (
          <LiveGauge
            label="CO₂"
            value={co2}
            unit="ppm"
            min={400}
            max={2000}
            color="var(--sl-co2)"
            detail="air freshness"
          />
        ) : (
          <LiveGauge
            label="Water"
            value={waterLevel}
            unit="%"
            min={0}
            max={100}
            color="var(--sl-spore)"
            badge={!isWaterCalibrated ? 'calibrate' : undefined}
            onClick={() => setModal({ type: 'water' })}
          />
        )}
      </div>

      <ProfileStrip
        profile={profileName || undefined}
        stage={stageName || undefined}
        day={Number.isFinite(growDay) ? growDay : undefined}
        stageDays={Number.isFinite(stageDays) ? stageDays : undefined}
        stages={demoMode || profileName || (stageName && stageName !== 'Idle') ? DEMO_STAGES : []}
      />

      <LightTimeline
        sunrise={lightSunrise}
        sunset={lightSunset}
        nowHour={currentHour}
        lightsOn={lightsOn}
        onClick={() => setModal({ type: 'light' })}
      />

      <div className="main-grid">
        {/* Row 1 */}
        <div className="card card-temp" onClick={() => setModal({ type: 'temperature' })}>
          {heatRequested && <div className="status-rectangle heating-badge">HEATING</div>}
          <div className="card-icon"><Icon name="thermometer" /></div>
          <div className="card-label">Temperature</div>
          <div className="card-value card-value-text">{trendText(tempSamples, 0.3)}</div>
          <div className="card-range">{tempRange ?? 'Range for today shows up soon'}</div>
        </div>

        <div className="card card-humidity" onClick={() => setModal({ type: 'humidity' })}>
          {humidifierOn && <div className="status-rectangle humidifying-badge">HUMIDIFYING</div>}
          <div className="card-icon"><Icon name="droplet" /></div>
          <div className="card-label">Humidity</div>
          <div className="card-value card-value-text">{trendText(humiditySamples, 1)}</div>
          <div className="card-target">{humidityRange ?? 'Range for today shows up soon'}</div>
        </div>

        <div className="card card-air" onClick={() => setModal({ type: 'air' })}>
          {airExchangeOn && <div className="status-rectangle running-badge">RUNNING</div>}
          <div className="card-icon"><Icon name="air" /></div>
          <div className="card-label">Air Exchange</div>
          <div className="card-value">
            {getNumber('air_exchange__period__min_')}
            <span className="card-unit">min</span>
          </div>
          <div className="card-detail">
            {getNumber('air_exchange__run_duration__s_')}s @ {getNumber('air_exchange__speed')}%
          </div>
        </div>

        {/* Row 2 */}
        <div className="card card-light" onClick={() => setModal({ type: 'light' })}>
          <div className="card-icon"><Icon name={lightsOn ? 'sun' : 'moon'} /></div>
          <div className="card-label">Lighting</div>
          <div className="card-value">
            {lightsOn ? getNumber('white_led_intensity') : 'OFF'}
            {lightsOn && <span className="card-unit">lux</span>}
          </div>
          <div className="card-schedule">
            {lightOnSummary(lightSunrise, lightDuration)}
          </div>
        </div>

        <div className="card card-water" onClick={() => setModal({ type: 'water' })}>
          {!isWaterCalibrated && <div className="status-rectangle humidifying-badge">NOT CALIBRATED</div>}
          <div className="card-icon"><Icon name="water" /></div>
          <div className="card-label">Water Level</div>
          <div className="card-value">
            {waterLevel.toFixed(0)}
            <span className="card-unit">%</span>
          </div>
        </div>

        <div className="card card-settings" onClick={() => setModal({ type: 'settings' })}>
          <div className="card-icon"><Icon name="gear" /></div>
          <div className="card-label">Settings</div>
          <div className="card-value">v{installedVersion}</div>
          <div className="card-detail">Chamber and Wi-Fi</div>
        </div>
      </div>

      {/* Footer */}
      <div className="footer">
        <a href="https://openshrooly.com" target="_blank" rel="noopener noreferrer" className="footer-link">
          OpenShrooly.com
        </a>
        <span className="footer-separator">•</span>
        <button onClick={() => setShowLicense(true)} className="footer-link footer-button">
          Open Source (MIT License)
        </button>
        <span className="footer-separator">•</span>
        <a href="https://esphome.io" target="_blank" rel="noopener noreferrer" className="footer-link">
          Powered by ESPHome
        </a>
        <span className="footer-separator">•</span>
        <span className="footer-text">Shroom Labs. Works with Shrooly devices running OpenShrooly. No warranty.</span>
      </div>

      {/* Modals */}
      {modal.type === 'water' && (() => {
        const isCalibrated = entities['binary_sensor-water_calibrated']?.state === 'ON' ||
                           entities['binary_sensor-water_calibrated']?.value === true

        return (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2><Icon name="water" size={22} className="heading-icon" />Water Level</h2>
            <div className="modal-content">
              <div className="water-level-display">
                <div className="water-level-value">{waterLevel.toFixed(0)}%</div>
                {waterLevel < 20 && (
                  <div className="water-warning">⚠️ Water is low. Please refill soon.</div>
                )}
              </div>

              {calibrationSuccess && (
                <div className="calibration-success">
                  ✅ Water level calibration complete! The sensor has been calibrated to measure from an empty tank.
                </div>
              )}

              <button
                className="calibrate-button"
                onClick={() => {
                  setCalibrationError('')
                  setModal({ type: 'calibrate' })
                }}
              >
                {isCalibrated ? 'Recalibrate Dry Tank' : 'Calibrate Water Level'}
              </button>

              {isCalibrated && (
                <button className="modal-cancel" style={{ width: '100%', marginBottom: '12px' }} onClick={resetWaterCalibration}>
                  Reset to Built-in Defaults
                </button>
              )}

              <div className="calibrate-info" style={isCalibrated ? { color: '#4ade80' } : undefined}>
                {isCalibrated
                  ? '✓ Sensor is calibrated'
                  : 'Calibrating tells the chamber what an empty tank looks like, so the water level reads correctly.'}
              </div>

              {calibrationError && (
                <div className="water-warning" style={{ marginTop: '12px' }}>
                  {calibrationError}
                </div>
              )}
            </div>
          </div>
        </div>
        )
      })()}

      {modal.type === 'calibrate' && (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal calibrate-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2><Icon name="water" size={22} className="heading-icon" />Water Calibration</h2>
            <div className="modal-content">
              <p className="calibrate-warning">
                ⚠️ Please completely empty and dry the water reservoir before calibrating.
              </p>
              <p className="calibrate-instruction">
                This saves the current reading as an empty tank, so the water level reads correctly.
              </p>
              <p className="calibrate-instruction">
                The reading will update immediately after calibration.
              </p>
              {calibrationError && <p className="calibrate-warning">{calibrationError}</p>}
            </div>
            <div className="modal-buttons">
              <button className="modal-cancel" onClick={() => setModal({ type: null })}>
                Cancel
              </button>
              <button
                className="modal-confirm"
                disabled={calibrationBusy}
                onClick={runWaterCalibration}
              >
                {calibrationBusy ? 'Calibrating…' : 'Calibrate Empty Tank'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal.type === 'humidity' && (() => {
        const hysteresis = Number(getNumber('humidity__hysteresis')) || 0
        const target = Number(getNumber('target_humidity')) || 70

        // Initialize ref with current values ONLY if not dragging
        if (!draggingHumidityHandle) {
          humidityDragValues.current = { target, hysteresis }
        }

        const lowerBound = target - hysteresis
        const upperBound = target + hysteresis

        // Calculate positions on 60-100% scale
        const targetPos = ((target - 60) / 40) * 100

        // Scale hysteresis visually by 2x for easier interaction
        const visualHysteresis = hysteresis * 2
        const lowerBoundVisual = target - visualHysteresis
        const upperBoundVisual = target + visualHysteresis
        const lowerPos = ((lowerBoundVisual - 60) / 40) * 100
        const upperPos = ((upperBoundVisual - 60) / 40) * 100

        // Offset for edge handles so they don't overlap when hysteresis is 0
        const handleOffset = 2 // pixels

        return (
          <div className="modal-overlay" onClick={() => setModal({ type: null })}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
              <h2><Icon name="droplet" size={22} className="heading-icon" />Humidity Control</h2>
              <div className="modal-content">
                <div className="control-group">
                  <label>Target: {target.toFixed(1)}% ± {hysteresis.toFixed(2)}% • Turns ON below {lowerBound.toFixed(1)}%, OFF {upperBound >= 100 ? 'at' : 'above'} {upperBound.toFixed(1)}%</label>
                  <div className="dual-slider-container humidity-slider-container">
                    {/* Target handle (center) - green circle */}
                    <div
                      className="humidity-handle-center"
                      style={{
                        position: 'absolute',
                        left: `${targetPos}%`,
                        top: '26px',
                        transform: 'translateX(-50%)',
                        width: '26px',
                        height: '26px',
                        background: '#22c55e',
                        border: '3px solid white',
                        borderRadius: '50%',
                        cursor: 'grab',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                        zIndex: 20
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('target')
                      }}
                      onTouchStart={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('target')
                      }}
                    />

                    {/* Humidity slider track with gradient */}
                    <div
                      className="humidity-slider-track"
                      style={{
                        position: 'absolute',
                        top: '35px',
                        left: 0,
                        right: 0,
                        height: '8px',
                        background: 'linear-gradient(to right, #f97316 0%, #3b82f6 100%)',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    />

                    {/* Hysteresis band - the acceptable range */}
                    <div
                      className="humidity-band"
                      style={{
                        position: 'absolute',
                        top: '30px',
                        left: `${lowerPos}%`,
                        width: `${upperPos - lowerPos}%`,
                        height: '18px',
                        background: 'rgba(34, 197, 94, 0.2)',
                        border: '2px solid rgba(34, 197, 94, 0.5)',
                        borderRadius: '4px',
                        pointerEvents: 'none'
                      }}
                    />

                    {/* Lower bound handle - on bottom, slightly left */}
                    <div
                      className="humidity-handle-edge"
                      style={{
                        position: 'absolute',
                        left: `calc(${Math.max(0, lowerPos)}% - ${handleOffset}px)`,
                        top: '63px',
                        transform: 'translateX(-50%)',
                        cursor: 'grab',
                        zIndex: 10
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('lower')
                      }}
                      onTouchStart={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('lower')
                      }}
                    >
                      <div className="humidity-tick">◀</div>
                    </div>

                    {/* Upper bound handle - on bottom, slightly right */}
                    <div
                      className="humidity-handle-edge"
                      style={{
                        position: 'absolute',
                        left: `calc(${Math.min(100, upperPos)}% + ${handleOffset}px)`,
                        top: '63px',
                        transform: 'translateX(-50%)',
                        cursor: 'grab',
                        zIndex: 10
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('upper')
                      }}
                      onTouchStart={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('upper')
                      }}
                    >
                      <div className="humidity-tick">▶</div>
                    </div>

                    {/* Humidity scale below track */}
                    <div className="dual-slider-scale" style={{ top: '80px' }}>
                      {[60, 65, 70, 75, 80, 85, 90, 95, 100].map(val => (
                        <div
                          key={val}
                          className="scale-mark"
                          style={{ left: `${((val - 60) / 40) * 100}%` }}
                        >
                          <div className="scale-tick"></div>
                          <div className="scale-label">{val}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="control-group">
                  <label>
                    Humidifier Speed: {getNumber('humidifier__speed')}%
                  </label>
                  <input
                    type="range"
                    min="50"
                    max="100"
                    step="5"
                    value={getNumber('humidifier__speed') as number}
                    onChange={(e) =>
                      handleNumberChange('number-humidifier__speed', parseFloat(e.target.value))
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {modal.type === 'temperature' && (() => {
        const tempHysteresis = Number(getNumber('temperature__hysteresis')) || 1
        const tempTarget = Number(getNumber('temperature__target')) || 22

        // Initialize ref with current values ONLY if not dragging
        if (!draggingTempHandle) {
          tempDragValues.current = { target: tempTarget, hysteresis: tempHysteresis }
        }

        const lowerTempBound = tempTarget - tempHysteresis
        const upperTempBound = tempTarget + tempHysteresis

        // Calculate positions on 15-35°C scale
        const targetTempPos = ((tempTarget - 15) / 20) * 100
        const lowerTempPos = ((lowerTempBound - 15) / 20) * 100
        const upperTempPos = ((upperTempBound - 15) / 20) * 100

        // Offset for edge handles so they don't overlap when hysteresis is 0
        const handleOffset = -10 // pixels - negative to move left

        return (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2><Icon name="thermometer" size={22} className="heading-icon" />Temperature Control</h2>
            <div className="modal-content">
              <div className="control-group" style={{ marginBottom: '20px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={entities['switch-temperature_control_enabled']?.state === 'ON' || entities['switch-temperature_control_enabled']?.value === true}
                    onChange={(e) =>
                      handleSwitchChange('switch-temperature_control_enabled', e.target.checked)
                    }
                  />
                  <span style={{ marginLeft: '8px' }}>Enable Temperature Control</span>
                </label>
              </div>

              {(entities['switch-temperature_control_enabled']?.state === 'ON' || entities['switch-temperature_control_enabled']?.value === true) && (
                <>
                  <div className="temp-disclaimer" style={{ marginBottom: '20px' }}>
                    ⚠️ <strong>Important:</strong> The chamber can ask for heat, but it cannot run a heater by itself. Pair a heater with your smart home system, such as Home Assistant, so it turns on when the chamber asks for heat.
                  </div>

                  <div className="control-group">
                    <label style={{ marginBottom: '10px', display: 'block' }}>
                      Target Temperature: {tempTarget.toFixed(1)}°C (±{tempHysteresis.toFixed(2)}°C)
                    </label>
                    <div style={{ position: 'relative', height: '100px', marginBottom: '10px' }}>
                      {/* Temperature slider track */}
                      <div
                        className="temperature-slider-track"
                        style={{
                          position: 'absolute',
                          top: '35px',
                          left: 0,
                          right: 0,
                          height: '8px',
                          background: 'linear-gradient(to right, #60a5fa 0%, #ef4444 100%)',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      />

                      {/* Hysteresis band - the acceptable range */}
                      <div
                        className="temperature-band"
                        style={{
                          position: 'absolute',
                          top: '30px',
                          left: `${lowerTempPos}%`,
                          width: `${upperTempPos - lowerTempPos}%`,
                          height: '18px',
                          background: 'rgba(34, 197, 94, 0.2)',
                          border: '2px solid rgba(34, 197, 94, 0.5)',
                          borderRadius: '4px',
                          pointerEvents: 'none'
                        }}
                      />

                      {/* Target handle - center point */}
                      <div
                        className="temperature-handle-center"
                        style={{
                          position: 'absolute',
                          left: `${targetTempPos}%`,
                          top: '26px',
                          transform: 'translateX(-50%)',
                          width: '26px',
                          height: '26px',
                          background: '#22c55e',
                          border: '3px solid white',
                          borderRadius: '50%',
                          cursor: 'grab',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                          zIndex: 20
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('target')
                        }}
                        onTouchStart={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('target')
                        }}
                      />

                      {/* Lower bound handle - on bottom, left */}
                      <div
                        className="temperature-handle-edge"
                        style={{
                          position: 'absolute',
                          left: `calc(${Math.max(0, lowerTempPos)}% + ${handleOffset}px)`,
                          top: '63px',
                          transform: 'translateX(-50%)',
                          cursor: 'grab',
                          zIndex: 10
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('lower')
                        }}
                        onTouchStart={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('lower')
                        }}
                      >
                        <div className="temperature-tick">◀</div>
                      </div>

                      {/* Upper bound handle - on bottom, right */}
                      <div
                        className="temperature-handle-edge"
                        style={{
                          position: 'absolute',
                          left: `calc(${Math.min(100, upperTempPos)}% - ${handleOffset}px)`,
                          top: '63px',
                          transform: 'translateX(-50%)',
                          cursor: 'grab',
                          zIndex: 10
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('upper')
                        }}
                        onTouchStart={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('upper')
                        }}
                      >
                        <div className="temperature-tick">▶</div>
                      </div>

                      {/* Temperature scale below track */}
                      <div className="dual-slider-scale" style={{ top: '80px' }}>
                        {[15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35].map(val => (
                          <div
                            key={val}
                            className="scale-mark"
                            style={{ left: `${((val - 15) / 20) * 100}%` }}
                          >
                            <div className="scale-tick"></div>
                            <div className="scale-label">{val}°C</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Temperature Warning Thresholds Section */}
              <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '15px', color: '#6b7280' }}>
                  Temperature Warnings
                </h3>
                <div className="temp-disclaimer" style={{ marginBottom: '15px' }}>
                  ℹ️ <strong>Note:</strong> These limits only show a warning here. To get alerts on your phone or act on them, connect the chamber to a smart home system such as Home Assistant.
                </div>
                <div className="control-group">
                  <label>Warning Minimum: {getNumber('temperature__warning_minimum')}°C</label>
                  <input
                    type="number"
                    min="10"
                    max="25"
                    step="0.5"
                    value={getNumber('temperature__warning_minimum') as number}
                    onChange={(e) =>
                      handleNumberChange('number-temperature__warning_minimum', parseFloat(e.target.value))
                    }
                  />
                </div>
                <div className="control-group">
                  <label>Warning Maximum: {getNumber('temperature__warning_maximum')}°C</label>
                  <input
                    type="number"
                    min="20"
                    max="35"
                    step="0.5"
                    value={getNumber('temperature__warning_maximum') as number}
                    onChange={(e) =>
                      handleNumberChange('number-temperature__warning_maximum', parseFloat(e.target.value))
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        )
      })()}

      {modal.type === 'air' && (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2><Icon name="air" size={22} className="heading-icon" />Air Exchange</h2>
            <div className="modal-content">
              <div className="control-group">
                <label>Period: {getNumber('air_exchange__period__min_')} minutes</label>
                <input
                  type="number"
                  min="1"
                  max="240"
                  value={getNumber('air_exchange__period__min_') as number}
                  onChange={(e) =>
                    handleNumberChange(
                      'number-air_exchange__period__min_',
                      parseFloat(e.target.value)
                    )
                  }
                />
              </div>
              <div className="control-group">
                <label>
                  Run Duration: {getNumber('air_exchange__run_duration__s_')} seconds
                </label>
                <input
                  type="number"
                  min="5"
                  max="900"
                  step="5"
                  value={getNumber('air_exchange__run_duration__s_') as number}
                  onChange={(e) =>
                    handleNumberChange(
                      'number-air_exchange__run_duration__s_',
                      parseFloat(e.target.value)
                    )
                  }
                />
              </div>
              <div className="control-group">
                <label>Fan Speed: {getNumber('air_exchange__speed')}%</label>
                <input
                  type="range"
                  min="15"
                  max="100"
                  step="5"
                  value={getNumber('air_exchange__speed') as number}
                  onChange={(e) =>
                    handleNumberChange('number-air_exchange__speed', parseFloat(e.target.value))
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {modal.type === 'light' && (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2>💡 Lighting Schedule</h2>
            <div className="modal-content">
              <div className="control-group">
                <label>{lightOnSummary(lightSunrise, lightDuration)} ({lightDuration.toFixed(1)}h)</label>
                <p className="lux-guide">Duration is required when the light is on. 0 hours is only for a dark stage with lux 0 and RGB 0.</p>
                <label htmlFor="light-duration-hours">Duration (hours)</label>
                <input
                  id="light-duration-hours"
                  type="number"
                  min={lightEnabled ? 0.25 : 0}
                  max={24}
                  step={0.25}
                  required={lightEnabled}
                  value={Number.isFinite(lightDuration) ? lightDuration : ''}
                  onChange={(e) => handleDurationChange(parseFloat(e.target.value))}
                />
                {durationRequired ? (
                  <div className="warning-message" role="alert" style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', color: '#856404' }}>
                    Duration is required when the light is on. Using 12 hours.
                  </div>
                ) : null}
                <div className="dual-slider-container">
                  {/* Sunrise handle with sun icon - above track */}
                  <div
                    className="slider-handle-container"
                    style={{ left: `${(lightSunrise / 24) * 100}%`, top: '15px' }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setDraggingHandle('sunrise')
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault()
                      setDraggingHandle('sunrise')
                    }}
                  >
                    <div className="slider-icon">☀️</div>
                  </div>

                  {/* Sunset handle with moon icon - above track */}
                  <div
                    className="slider-handle-container"
                    style={{ left: `${(lightSunset / 24) * 100}%`, top: '15px' }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setDraggingHandle('sunset')
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault()
                      setDraggingHandle('sunset')
                    }}
                  >
                    <div className="slider-icon"><Icon name="moon" size={16} /></div>
                  </div>

                  <div className="dual-slider-track">
                    {/* Yellow segment for lights ON */}
                    {lightSunset >= lightSunrise ? (
                      // Normal case: single segment from sunrise to sunset
                      <div
                        className="dual-slider-range dual-slider-on"
                        style={{
                          left: `${(lightSunrise / 24) * 100}%`,
                          width: `${((lightSunset - lightSunrise) / 24) * 100}%`
                        }}
                      />
                    ) : (
                      // Wraps past midnight: two segments
                      <>
                        <div
                          className="dual-slider-range dual-slider-on"
                          style={{
                            left: `${(lightSunrise / 24) * 100}%`,
                            width: `${((24 - lightSunrise) / 24) * 100}%`
                          }}
                        />
                        <div
                          className="dual-slider-range dual-slider-on"
                          style={{
                            left: '0%',
                            width: `${(lightSunset / 24) * 100}%`
                          }}
                        />
                      </>
                    )}
                  </div>

                  {/* Time scale below track */}
                  <div className="dual-slider-scale" style={{ top: '68px' }}>
                    {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(hour => (
                      <div
                        key={hour}
                        className="scale-mark"
                        style={{ left: `${(hour / 24) * 100}%` }}
                      >
                        <div className="scale-tick"></div>
                        <div className="scale-label">{hour.toString().padStart(2, '0')}:00</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="control-group">
                <label>White Intensity: {luxValue} lux</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.1"
                  value={luxToSlider(luxValue)}
                  onChange={(e) => handleLuxChange(parseFloat(e.target.value))}
                />
                {luxValue > 1000 && (
                  <div className="warning-message" style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', color: '#856404' }}>
                    ⚠️ Very few mushroom species like this light level. High light can cause bleached or discolored caps.
                  </div>
                )}
                <div className="lux-guide">
                  Most mushrooms need minimal light - <strong>150 lux is typically sufficient</strong>. Light is primarily for pinning and directing growth, not energy production. Higher levels may cause bleaching or discolored caps.
                </div>
              </div>
              <div className="color-picker-row">
                <label>RGB Color:</label>
                <input
                  type="color"
                  className="color-picker-small"
                  value={currentColor}
                  onChange={(e) => handleColorChange(e.target.value)}
                />
                <span className="color-value-text">
                  {redValue === 0 && greenValue === 0 && blueValue === 0 ? (
                    'OFF'
                  ) : (
                    `R:${redValue} G:${greenValue} B:${blueValue}`
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal.type === 'settings' && (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2><Icon name="gear" size={22} className="heading-icon" />Settings</h2>
            <div className="modal-content">
              <div className="settings-section">
                <h3>System Information</h3>
                <div className="settings-info">
                  <div className="info-row">
                    <span className="info-label">Version:</span>
                    <span className="info-value">{installedVersion}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Voltage:</span>
                    <span className="info-value">{parseFloat(getSensor('system_voltage') as string || '0').toFixed(2)}V</span>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3>Network</h3>
                <div className="settings-info">
                  <div className="info-row">
                    <span className="info-label">Connection:</span>
                    <span className="info-value">{connectionLabel(entities['text_sensor-wifi_mode']?.state)}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Wi-Fi network:</span>
                    <span className="info-value">{entities['text_sensor-wifi_ssid']?.state || 'Unknown'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Chamber address:</span>
                    <span className="info-value">{entities['text_sensor-ip_address']?.state || 'Unknown'}</span>
                  </div>
                </div>
              </div>

              <CloudSettings demo={demoMode} open={modal.type === 'settings'} />

              <div className="settings-section">
                <h3>Display & Time</h3>
                <div className="control-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={flipScreen}
                      onChange={(e) => handleFlipScreenChange(e.target.checked)}
                    />
                    <span style={{ marginLeft: '8px' }}>Flip screen</span>
                  </label>
                </div>
                <div className="control-group">
                  <label>Timezone</label>
                  <select
                    className="control-select"
                    value={timezone}
                    onChange={(e) => handleTimezoneChange(e.target.value)}
                    disabled={timezoneOptions.length === 0 || timezoneUpdating}
                  >
                    {timezoneOptions.length === 0 ? (
                      <option value={timezone}>{timezone || 'Loading timezones…'}</option>
                    ) : (
                      timezoneOptions.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))
                    )}
                  </select>
                  {timezoneUpdating && (
                    <div className="control-help">Applying timezone…</div>
                  )}
                  {timezoneError && (
                    <div className="control-error">{timezoneError}</div>
                  )}
                </div>
              </div>

              <div className="settings-section">
                <h3>Software update</h3>
                <div className="settings-info">
                  <div className="info-row">
                    <span className="info-label">Installed version:</span>
                    <span className="info-value">{installedVersion}</span>
                  </div>
                </div>
                <div className="control-group">
                  <div className={`ota-message${updateState === 'failed' ? ' is-error' : updateState === 'current' || updateState === 'restarting' ? ' is-success' : ''}`} aria-live="polite">
                    {updateStatus}
                  </div>
                  {updateState === 'downloading' && (
                    <div className="ota-track">
                      <div className="ota-fill" style={{ width: `${updateProgress}%` }} />
                    </div>
                  )}
                  <button
                    onClick={handleCheckForUpdate}
                    disabled={updateBusy || !reachable}
                    className="charts-button ota-button"
                  >
                    {updateState === 'checking' ? 'Checking…' : 'Check for updates'}
                  </button>
                  {updateState === 'available' && availableVersion && (
                    <>
                      <button
                        onClick={handleInstallUpdate}
                        disabled={updateBusy}
                        className="charts-button ota-button update-install"
                      >
                        Install version {availableVersion}
                      </button>
                      <div className="control-help">
                        Your Shrooly checks the download is a genuine Shroom Labs release before using it, then restarts. Your grow settings are kept.
                      </div>
                    </>
                  )}
                  <div className="control-help">
                    Updates come only from shroomlabs.io and are checked only when you press the button.
                  </div>
                </div>
                <details className="update-advanced">
                  <summary>More update options</summary>
                  <div className="control-group">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={allowOlder}
                        onChange={(e) => handleAllowOlderChange(e.target.checked)}
                        disabled={updateBusy}
                      />
                      <span style={{ marginLeft: '8px' }}>Allow going back to an older version</span>
                    </label>
                    <div className="control-help">
                      Turns itself off when your Shrooly restarts.
                    </div>
                  </div>
                  <div className="control-group">
                    <label>Install from a file on this computer</label>
                    <div className="control-help">
                      Only signed Shroom Labs releases are accepted here: the file ending in .signed.bin from shroomlabs.io. To install anything else, use a USB cable.
                    </div>
                    <input
                      type="file"
                      accept=".bin"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          setOtaFile(file)
                          setOtaStatus('idle')
                          setOtaMessage('')
                        }
                      }}
                      disabled={otaStatus === 'uploading'}
                      className="ota-file"
                    />
                    {otaFile && (
                      <div className="ota-meta">
                        Selected: {otaFile.name} ({(otaFile.size / 1024 / 1024).toFixed(2)} MB)
                      </div>
                    )}
                    <button
                      onClick={handleOtaUpload}
                      disabled={!otaFile || otaStatus === 'uploading'}
                      className="charts-button ota-button"
                    >
                      {otaStatus === 'uploading' ? 'Sending…' : 'Install this file'}
                    </button>
                    {otaStatus !== 'idle' && (
                      <div>
                        {otaStatus === 'uploading' && (
                          <div className="ota-track">
                            <div className="ota-fill" style={{ width: `${otaProgress}%` }} />
                          </div>
                        )}
                        <div className={`ota-message${otaStatus === 'success' ? ' is-success' : otaStatus === 'error' ? ' is-error' : ''}`}>
                          {otaMessage}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="control-group">
                    <label>Passwords and Home Assistant key</label>
                    <div className="control-help">
                      Anyone on your home network can view this page. Changing settings asks you to log in: the user name is admin and the password is on the chamber screen under Menu, System.{' '}
                      <a href="/security">Show this chamber&apos;s passwords and Home Assistant key</a>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* License Modal */}
      {showLicense && (
        <div className="modal-overlay" onClick={() => setShowLicense(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setShowLicense(false)}>×</button>
            <h2>MIT License</h2>
            <div className="modal-content">
              <div className="license-text">
                <p>Copyright (c) 2025-2026 OpenShrooly Contributors</p>
                <p>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:</p>
                <p>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.</p>
                <p><strong>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</strong></p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
