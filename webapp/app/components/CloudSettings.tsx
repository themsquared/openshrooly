'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { claimUrl, drawQrModules } from '../../lib/cloud-claim'

type CloudStatus = {
  enabled: boolean
  state: string
  linked: boolean
  claim_code: string
  claim_url: string
  expires_in_s: number
  message: string
  qr_size: number
  qr: string
}

export default function CloudSettings({ demo, open }: { demo: boolean; open: boolean }) {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const load = useCallback(async () => {
    if (demo) {
      setStatus({
        enabled: false,
        state: 'off',
        linked: false,
        claim_code: '',
        claim_url: '',
        expires_in_s: 0,
        message: 'Cloud is optional. Your chamber still works if we are down.',
        qr_size: 0,
        qr: '',
      })
      return
    }
    setError('')
    try {
      const res = await fetch('/cloud', { credentials: 'same-origin' })
      if (res.status === 401) {
        setError('Sign in to manage cloud. User name admin, password on the chamber screen under Menu, System.')
        return
      }
      if (!res.ok) {
        setError('Could not read the cloud setting.')
        return
      }
      setStatus(await res.json())
    } catch {
      setError('Could not read the cloud setting.')
    }
  }, [demo])

  useEffect(() => {
    if (open)
      void load()
  }, [open, load])

  useEffect(() => {
    if (!status?.qr || !status.qr_size || !canvasRef.current)
      return
    drawQrModules(canvasRef.current, status.qr, status.qr_size)
  }, [status])

  async function post(path: string) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(path, { method: 'POST', credentials: 'same-origin' })
      if (res.status === 401) {
        setError('Sign in to manage cloud. User name admin, password on the chamber screen under Menu, System.')
        return
      }
      if (res.status === 403) {
        setError('This change must be made from the chamber\'s own page.')
        return
      }
      if (!res.ok) {
        setError('Could not update the cloud setting.')
        return
      }
      setStatus(await res.json())
    } catch {
      setError('Could not update the cloud setting.')
    } finally {
      setBusy(false)
    }
  }

  const code = status?.claim_code || ''
  const url = status?.claim_url || (code ? claimUrl(code) : '')
  const minutes = status ? Math.max(0, Math.ceil((status.expires_in_s || 0) / 60)) : 0

  return (
    <div className="settings-section">
      <h3>Shroom Labs cloud</h3>
      <div className="control-help">
        Cloud is optional. Your chamber still works if we are down.
      </div>
      <div className="control-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={Boolean(status?.enabled)}
            disabled={busy || demo}
            onChange={(e) => {
              if (e.target.checked)
                void post('/cloud/connect')
              else
                void post('/cloud/disconnect')
            }}
          />
          <span>Connect to Shroom Labs</span>
        </label>
      </div>
      {status?.linked && (
        <div className="cloud-linked" role="status">Linked to your Shroom Labs account</div>
      )}
      {status?.enabled && !status.linked && code && (
        <div className="cloud-claim">
          <div className="cloud-code" aria-label="Claim code">{code}</div>
          {url && (
            <div className="control-help">
              Scan the code or open <a href={url}>{url.replace('https://', '')}</a>
            </div>
          )}
          {status.qr_size > 0 && (
            <canvas
              ref={canvasRef}
              className="cloud-qr"
              width={168}
              height={168}
              aria-label="Claim QR code"
            />
          )}
          <div className="control-help">
            {minutes > 0 ? `This code expires in ${minutes} min.` : 'This code has expired. Refresh for a new one.'}
          </div>
          <button
            type="button"
            className="charts-button ota-button"
            disabled={busy || demo}
            onClick={() => void post('/cloud/refresh')}
          >
            Refresh code
          </button>
        </div>
      )}
      {status?.message && <div className="control-help">{status.message}</div>}
      {error && <div className="control-error">{error}</div>}
      {status?.enabled && !status.linked && (
        <button
          type="button"
          className="charts-button ota-button"
          disabled={busy || demo}
          onClick={() => void post('/cloud/disconnect')}
        >
          Disconnect
        </button>
      )}
    </div>
  )
}
