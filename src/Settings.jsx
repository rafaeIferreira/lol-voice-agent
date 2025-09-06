import React, { useEffect, useState, useCallback, useRef } from 'react'

function niceKey(code) {
  // Simplifica exibição do code (e.g. "KeyV" -> "V", "ShiftLeft" -> "Shift")
  if (!code) return '—'
  if (code.startsWith('Key')) return code.replace('Key', '')
  if (code.startsWith('Digit')) return code.replace('Digit', '')
  if (code.includes('Shift')) return 'Shift'
  if (code.includes('Control')) return 'Ctrl'
  if (code.includes('Alt')) return 'Alt'
  if (code === 'Space') return 'Space'
  return code
}

export default function Settings({ sett, onChange, brand }) {
  const [inputs, setInputs] = useState([])
  const [outputs, setOutputs] = useState([])
  const [capturing, setCapturing] = useState(false)
  const captureAbort = useRef(null)

  const styles = {
    card: {
      width: 920, maxWidth: '96vw',
      border: `1px solid ${brand.border}`,
      background: brand.card, borderRadius: 18, padding: 18,
      boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
    },
    headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    pill: { fontSize: 12, color: '#111', background: brand.accent, padding: '6px 12px', borderRadius: 999, fontWeight: 800, letterSpacing: 0.4 },
    settingsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
    statBox: { border: `1px solid ${brand.border}`, background: '#101010', borderRadius: 14, padding: 14, minHeight: 92 },
    field: { display: 'flex', flexDirection: 'column', gap: 6 },
    label: { fontSize: 12, color: brand.sub },
    select: {
      background: '#0f0f0f', color: '#f2f2f2', border: `1px solid ${brand.border}`, borderRadius: 10,
      padding: '10px 12px', outline: 'none',
    },
    row: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 },
    checkbox: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 },
    range: { width: '100%' },
    hint: { marginTop: 10, fontSize: 12, color: brand.sub },
    topRow: { display: 'flex', alignItems: 'center', gap: 8 },
    refreshBtn: {
      padding: '6px 10px', borderRadius: 8,
      border: `1px solid ${brand.accent}`, background: brand.accent, color: '#0b0b0b',
      cursor: 'pointer', fontWeight: 800, fontSize: 12
    },
    resetBtn: {
      padding: '6px 10px', borderRadius: 8,
      border: `1px solid #ef4444`, background: '#ef4444', color: '#0b0b0b',
      cursor: 'pointer', fontWeight: 800, fontSize: 12
    },
    keyBtn: {
      padding: '8px 12px', borderRadius: 10,
      border: `1px solid ${capturing ? brand.accent : brand.border}`,
      background: capturing ? brand.accent : '#141414',
      color: capturing ? '#0b0b0b' : '#f2f2f2',
      cursor: 'pointer', fontWeight: 800
    }
  }

  const refreshDevices = useCallback(async () => {
    try {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true })
        tmp.getTracks().forEach(t => t.stop())
      } catch { }
      const list = await navigator.mediaDevices.enumerateDevices()
      setInputs(list.filter(d => d.kind === 'audioinput'))
      setOutputs(list.filter(d => d.kind === 'audiooutput'))
    } catch { }
  }, [])

  useEffect(() => {
    refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
  }, [refreshDevices])

  const reset = () => {
    onChange({
      micDeviceId: '',
      outDeviceId: '',
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      masterVolume: 1.0,
      micGain: 1.0,
      pttEnabled: false,
      pttKey: 'KeyV',
    })
  }

  const startCaptureKey = () => {
    if (capturing) return
    setCapturing(true)
    const handler = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const code = e.code || e.key
      onChange({ ...sett, pttKey: code || 'KeyV' })
      stopCaptureKey()
    }
    const stopCaptureKey = () => {
      setCapturing(false)
      window.removeEventListener('keydown', handler, true)
      captureAbort.current = null
    }
    captureAbort.current = stopCaptureKey
    window.addEventListener('keydown', handler, true)
    // auto-cancel após 10s
    setTimeout(() => { if (captureAbort.current) captureAbort.current() }, 10000)
  }

  const cancelCapture = () => {
    if (captureAbort.current) captureAbort.current()
  }

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <div style={{ fontSize: 12, color: brand.sub }}>Configurações</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Áudio & Gerais</div>
        </div>
        <div style={styles.topRow}>
          <button style={styles.refreshBtn} onClick={refreshDevices}>Atualizar dispositivos</button>
          <div style={styles.pill}>Swell Voice</div>
        </div>
      </div>

      <div style={styles.settingsGrid}>
        {/* MIC */}
        <div style={{ ...styles.statBox, minHeight: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Microfone</div>
          <div style={styles.field}>
            <label style={styles.label}>Dispositivo de entrada</label>
            <select
              value={sett.micDeviceId}
              onChange={(e) => onChange({ ...sett, micDeviceId: e.target.value })}
              style={styles.select}
            >
              <option value="">Padrão do sistema</option>
              {inputs.map((d) => (
                <option key={d.deviceId || d.label} value={d.deviceId}>
                  {d.label || 'Microfone'}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.row}>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={sett.echoCancellation}
                onChange={(e) => onChange({ ...sett, echoCancellation: e.target.checked })}
              />
              Echo cancellation
            </label>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={sett.noiseSuppression}
                onChange={(e) => onChange({ ...sett, noiseSuppression: e.target.checked })}
              />
              Noise suppression
            </label>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={sett.autoGainControl}
                onChange={(e) => onChange({ ...sett, autoGainControl: e.target.checked })}
              />
              Auto gain
            </label>
          </div>

          {/* NOVO: Volume do Microfone */}
          <div style={{ ...styles.field, marginTop: 12 }}>
            <label style={styles.label}>Volume do microfone ({Math.round((sett.micGain ?? 1) * 100)}%)</label>
            <input
              type="range"
              min={0} max={2} step={0.01}
              value={sett.micGain ?? 1}
              onChange={(e) => onChange({ ...sett, micGain: Number(e.target.value) })}
              style={styles.range}
            />
          </div>

          {/* NOVO: Push-to-Talk */}
          <div style={{ ...styles.field, marginTop: 12 }}>
            <label style={styles.label}>Push-to-Talk</label>
            <div style={styles.row}>
              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={!!sett.pttEnabled}
                  onChange={(e) => onChange({ ...sett, pttEnabled: e.target.checked })}
                />
                Ativar PTT (segurar tecla para falar)
              </label>
            </div>
            <div className="ptt-bind" style={{ ...styles.row, marginTop: 8 }}>
              <button style={styles.keyBtn} onClick={capturing ? cancelCapture : startCaptureKey}>
                {capturing ? 'Pressione uma tecla…' : `Definir atalho (${niceKey(sett.pttKey)})`}
              </button>
              {capturing && <div style={{ fontSize: 12, color: brand.sub }}>Capturando… (ESC para cancelar)</div>}
            </div>
            <div style={{ ...styles.hint, marginTop: 6 }}>
              Dica: o atalho funciona quando a janela do app está em foco.
            </div>
          </div>
        </div>

        {/* OUTPUT & MASTER */}
        <div style={{ ...styles.statBox, minHeight: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Saída & Geral</div>

          <div style={styles.field}>
            <label style={styles.label}>Dispositivo de saída</label>
            <select
              value={sett.outDeviceId}
              onChange={(e) => onChange({ ...sett, outDeviceId: e.target.value })}
              style={styles.select}
            >
              <option value="">Padrão do sistema</option>
              {outputs.map((d) => (
                <option key={d.deviceId || d.label} value={d.deviceId}>
                  {d.label || 'Saída de áudio'}
                </option>
              ))}
            </select>
          </div>

          <div style={{ ...styles.field, marginTop: 12 }}>
            <label style={styles.label}>Volume master ({Math.round((sett.masterVolume ?? 1) * 100)}%)</label>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={sett.masterVolume ?? 1}
              onChange={(e) => onChange({ ...sett, masterVolume: Number(e.target.value) })}
              style={styles.range}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <button style={styles.resetBtn} onClick={reset}>Resetar configurações</button>
          </div>
        </div>
      </div>

      <div style={styles.hint}>
        Trocas de microfone/saída valem para a próxima conexão e, quando possível, para streams já em reprodução.
      </div>
    </div>
  )
}
