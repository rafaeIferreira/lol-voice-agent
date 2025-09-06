import React, { useEffect, useRef, useState, useMemo } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'

// Imagem do campeão
function champTile(championName, skinIndex = 0) {
  if (!championName) return null
  const safe = String(championName).replaceAll("'", '').replaceAll(' ', '').replaceAll('.', '')
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/tiles/${safe}_${skinIndex}.jpg`
}

function useThemeByTeam(team) {
  if (team === 'ORDER') {
    return {
      bg: 'linear-gradient(135deg, #0b1020 0%, #0f1a3a 100%)',
      card: '#0f172a',
      text: '#e5f0ff',
      accent: '#3b82f6',
      ring: '#60a5fa',
      chipBg: '#0b2859',
      chipText: '#bcd8ff',
    }
  }
  return {
    bg: 'linear-gradient(135deg, #150b0b 0%, #2a0f0f 100%)',
    card: '#1a0f0f',
    text: '#ffecec',
    accent: '#ef4444',
    ring: '#f87171',
    chipBg: '#3a0f0f',
    chipText: '#ffd1d1',
  }
}

export default function VoiceRoom({
  backendUrl,
  roomName,
  displayName,
  team,
  teammates = [],
  audioConstraints = {},   // { deviceId, echoCancellation, noiseSuppression, autoGainControl }
  outputDeviceId,          // setSinkId
  masterVolume = 1,        // 0..1
  micGain = 1,             // 0..2 (usamos 0..2), default 1.0
  pttEnabled = false,      // push-to-talk ativado?
  pttKey = 'KeyV',         // tecla (e.code)
  onLeave,
}) {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [muted, setMuted] = useState(false)
  const [activeSpeakers, setActiveSpeakers] = useState([]) // names/identities
  const [remoteNames, setRemoteNames] = useState([])

  // volumes individuais (default 80%), mute-all e mutes individuais
  const [userVolume, setUserVolume] = useState(() => ({}))
  const [muteAll, setMuteAll] = useState(false)
  const [mutedUsers, setMutedUsers] = useState(() => (new Set()))

  const roomRef = useRef(null)
  const audioElsRef = useRef(new Map()) // Map<trackKey, HTMLAudioElement>

  // pipeline de MIC (ganho + PTT)
  const micStreamRef = useRef(null)        // MediaStream do getUserMedia
  const micProcessedTrackRef = useRef(null) // track processado (dest.stream)
  const audioCtxRef = useRef(null)
  const gainNodeRef = useRef(null)
  const pttHeldRef = useRef(false)

  const theme = useThemeByTeam(team)
  const headerGlow = `0 0 20px ${theme.accent}55, 0 0 40px ${theme.accent}33`

  // Helpers LiveKit
  const getRemoteMap = (r) => {
    const m = r?.participants ?? r?.remoteParticipants ?? null
    if (m && typeof m.values === 'function') return m
    return new Map(Object.entries(m || {}))
  }
  const iterPublications = (participant) => {
    const candidates = [
      participant?.tracks,
      participant?.trackPublications,
      participant?.audioTracks,
      participant?.videoTracks,
    ]
    for (const c of candidates) {
      if (!c) continue
      if (typeof c.values === 'function') return Array.from(c.values())
      if (Array.isArray(c)) return c
      if (typeof c === 'object') return Object.values(c)
    }
    if (typeof participant?.getTrackPublications === 'function') {
      try { return Array.from(participant.getTrackPublications()) } catch { }
    }
    return []
  }

  // aplica saída/volume dos REMOTOS
  const applyAudioOutputAndVolume = (audioEl, participantNameLower) => {
    const isUserMuted = mutedUsers.has(participantNameLower)
    const baseVol = userVolume[participantNameLower] ?? 0.8
    const vol = (muteAll || isUserMuted) ? 0 : Math.max(0, Math.min(1, baseVol)) * Math.max(0, Math.min(1, masterVolume))
    try { audioEl.volume = vol } catch { }
    if (outputDeviceId && typeof audioEl.setSinkId === 'function') {
      if (audioEl.sinkId !== outputDeviceId) {
        audioEl.setSinkId(outputDeviceId).catch(() => { })
      }
    }
  }

  const attachAudio = (track, participant) => {
    try {
      if (!track || track.kind !== Track.Kind.Audio) return
      const key = track.sid || track.mediaStreamTrack?.id || Math.random().toString(36).slice(2)
      if (audioElsRef.current.has(key)) return

      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.playsInline = true
      track.attach(audio)
      document.body.appendChild(audio)
      audioElsRef.current.set(key, audio)

      const pname = (participant?.name || participant?.identity || '').toLowerCase()
      audio.dataset.pname = pname
      if (userVolume[pname] == null) setUserVolume((prev) => ({ ...prev, [pname]: 0.8 }))
      applyAudioOutputAndVolume(audio, pname)
    } catch { }
  }

  const detachAudio = (track) => {
    try {
      const key = track?.sid || track?.mediaStreamTrack?.id
      if (!key) return
      const el = audioElsRef.current.get(key)
      if (el) {
        track.detach(el)
        el.remove()
        audioElsRef.current.delete(key)
      }
    } catch { }
  }

  const refreshParticipants = () => {
    const room = roomRef.current
    if (!room) return
    const remotes = getRemoteMap(room)
    const names = []
    for (const p of remotes.values()) names.push(p.name || p.identity)
    setRemoteNames(names)
  }

  const onActiveSpeakers = () => {
    const room = roomRef.current
    if (!room || !room.activeSpeakers) return
    const ids = room.activeSpeakers.map(s => s.participant?.name || s.participant?.identity).filter(Boolean)
    setActiveSpeakers(ids)
  }

  // reaplicar volume/saída quando controles mudam
  useEffect(() => {
    for (const el of audioElsRef.current.values()) {
      const nameLower = (el.dataset?.pname || '').toLowerCase()
      if (nameLower) applyAudioOutputAndVolume(el, nameLower)
    }
  }, [masterVolume, muteAll, mutedUsers, userVolume, outputDeviceId])

  // --------- MIC PIPELINE (ganho + PTT) ----------
  const updateMicEnabled = () => {
    const track = micProcessedTrackRef.current
    if (!track) return
    // regra: se PTT ativo => só fala quando tecla pressionada e não mutado
    // se PTT inativo => fala quando não mutado
    const want = pttEnabled ? (pttHeldRef.current && !muted) : (!muted)
    try { track.enabled = !!want } catch { }
  }

  useEffect(() => {
    // atualiza ganho do mic ao vivo
    if (gainNodeRef.current) {
      try { gainNodeRef.current.gain.value = Math.max(0, Math.min(2, Number(micGain) || 0)) } catch { }
    }
  }, [micGain])

  useEffect(() => {
    // atualiza regra de PTT/mute quando flags mudam
    updateMicEnabled()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pttEnabled, muted])

  useEffect(() => {
    // listeners de PTT (apenas com app focado)
    const down = (e) => {
      if (!pttEnabled) return
      if ((e.code || e.key) === pttKey) {
        if (!pttHeldRef.current) {
          pttHeldRef.current = true
          updateMicEnabled()
        }
      }
    }
    const up = (e) => {
      if (!pttEnabled) return
      if ((e.code || e.key) === pttKey) {
        pttHeldRef.current = false
        updateMicEnabled()
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pttEnabled, pttKey])

  // conectar + publicar mic (via WebAudio/ganho)
  useEffect(() => {
    let mounted = true
      ; (async () => {
        try {
          setStatus('requesting-token')
          const { token, url } = await window.voiceAPI.join({
            backendUrl,
            roomName,
            identityName: displayName,
          })
          setStatus('connecting')

          const room = new Room()
          roomRef.current = room

          room.on(RoomEvent.ParticipantConnected, () => { refreshParticipants() })
          room.on(RoomEvent.ParticipantDisconnected, (p) => {
            for (const pub of iterPublications(p)) {
              const t = pub?.track ?? pub?.audioTrack ?? pub?.videoTrack
              if (t) detachAudio(t)
            }
            refreshParticipants()
          })
          room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
            attachAudio(track, participant)
            refreshParticipants()
          })
          room.on(RoomEvent.TrackUnsubscribed, (track) => {
            detachAudio(track)
            refreshParticipants()
          })
          room.on(RoomEvent.ActiveSpeakersChanged, () => { onActiveSpeakers() })

          await room.connect(url, token, { autoSubscribe: true })

          // --- preparar microfone com ganho ---
          const baseStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: audioConstraints.deviceId,
              echoCancellation: !!audioConstraints.echoCancellation,
              noiseSuppression: !!audioConstraints.noiseSuppression,
              autoGainControl: !!audioConstraints.autoGainControl,
            },
            video: false
          })
          micStreamRef.current = baseStream

          const ctx = new (window.AudioContext || window.webkitAudioContext)()
          audioCtxRef.current = ctx
          const source = ctx.createMediaStreamSource(baseStream)
          const gain = ctx.createGain()
          gain.gain.value = Math.max(0, Math.min(2, Number(micGain) || 0))
          gainNodeRef.current = gain
          const dest = ctx.createMediaStreamDestination()

          source.connect(gain).connect(dest)
          const processedTrack = dest.stream.getAudioTracks()[0]
          micProcessedTrackRef.current = processedTrack

          // publica track processado
          await room.localParticipant.publishTrack(processedTrack)

          // estado inicial (PTT/mute)
          pttHeldRef.current = false
          updateMicEnabled()

          // anexar remotos já presentes
          const remotes = getRemoteMap(room)
          for (const p of remotes.values()) {
            for (const pub of iterPublications(p)) {
              const t = pub?.track ?? pub?.audioTrack ?? pub?.videoTrack
              const kind = t?.kind ?? pub?.kind
              const subscribed = pub?.isSubscribed ?? true
              if (subscribed && t && kind === Track.Kind.Audio) attachAudio(t, p)
            }
          }

          setStatus('connected')
          refreshParticipants()
          onActiveSpeakers()
        } catch (e) {
          if (!mounted) return
          setError(String(e?.message || e))
          setStatus('error')
        }
      })()

    return () => {
      mounted = false
      const room = roomRef.current
      try {
        for (const el of audioElsRef.current.values()) el.remove()
        audioElsRef.current.clear()
      } catch { }
      // parar pipeline de mic
      try {
        micProcessedTrackRef.current?.stop?.()
      } catch { }
      try {
        micStreamRef.current?.getTracks?.().forEach(t => t.stop())
      } catch { }
      try {
        audioCtxRef.current?.close?.()
      } catch { }
      if (room) {
        try { room.disconnect() } catch { }
      }
      roomRef.current = null
      micProcessedTrackRef.current = null
      micStreamRef.current = null
      audioCtxRef.current = null
      gainNodeRef.current = null
      pttHeldRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    backendUrl, roomName, displayName,
    audioConstraints.deviceId, audioConstraints.echoCancellation, audioConstraints.noiseSuppression, audioConstraints.autoGainControl
  ])

  const toggleMute = async () => {
    setMuted((m) => {
      const next = !m
      // aplica no track local (sem sinalizar mudo para todos)
      updateMicEnabled()
      return next
    })
  }

  const connectedSet = useMemo(() =>
    new Set(remoteNames.map(n => (n || '').toLowerCase()))
    , [remoteNames])

  const isSpeaking = (name) =>
    activeSpeakers.some(n => (n || '').toLowerCase() === (name || '').toLowerCase())

  const cardStyle = { background: theme.card, border: `1px solid ${theme.accent}33`, borderRadius: 16, padding: 16 }
  const chipStyle = {
    display: 'inline-block', padding: '4px 10px', borderRadius: 999,
    background: theme.chipBg, color: theme.chipText, fontSize: 12, letterSpacing: 0.4, border: `1px solid ${theme.accent}55`,
  }

  const handleMuteAll = () => setMuteAll(v => !v)
  const handleMuteUser = (name) => {
    const key = (name || '').toLowerCase()
    setMutedUsers((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const handleUserVolume = (name, value) => {
    const key = (name || '').toLowerCase()
    setUserVolume(prev => ({ ...prev, [key]: value }))
    for (const el of audioElsRef.current.values()) {
      if ((el.dataset?.pname || '').toLowerCase() === key) applyAudioOutputAndVolume(el, key)
    }
  }

  // --- Círculos ativos (apenas enquanto fala) ---
  const speakingCircles = teammates
    .filter(t => connectedSet.has((t.name || '').toLowerCase()) && isSpeaking(t.name))
    .map((t, idx) => {
      const img = champTile(t.championName, t.skinIndex ?? 0)
      return (
        <div key={(t.name || idx) + '-spk'}
          style={{
            width: 40, height: 40, borderRadius: 999,
            border: `2px solid ${theme.ring}`,
            boxShadow: `0 0 12px ${theme.ring}`,
            backgroundImage: img ? `url(${img})` : 'none',
            backgroundSize: 'cover', backgroundPosition: 'center',
            opacity: 1, transition: 'opacity .15s ease',
          }}
          title={t.name}
        />
      )
    })

  return (
    <div style={{
      background: theme.bg,
      color: theme.text,
      borderRadius: 20,
      padding: 18,
      border: `1px solid ${theme.accent}40`,
      boxShadow: headerGlow,
      width: '100%',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Sala</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{roomName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={chipStyle}>{team === 'ORDER' ? 'TIME AZUL' : 'TIME VERMELHO'}</div>
          <button
            onClick={handleMuteAll}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: `1px solid ${theme.accent}`,
              background: muteAll ? '#00000055' : theme.accent,
              color: muteAll ? theme.accent : '#0b1020',
              cursor: 'pointer',
              fontWeight: 700
            }}
            title="Mutar todos"
          >
            {muteAll ? 'Desmutar todos' : 'Mutar todos'}
          </button>
          <button
            onClick={toggleMute}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: `1px solid ${theme.accent}`,
              background: muted ? '#00000055' : theme.accent,
              color: muted ? theme.accent : '#0b1020',
              cursor: 'pointer',
              fontWeight: 700
            }}
            title={pttEnabled ? `PTT (${pttKey})` : 'Mutar meu microfone'}
          >
            {pttEnabled ? (muted ? 'PTT: mudo' : `PTT: ${pttKey}`) : (muted ? 'Desmutar' : 'Mutar')}
          </button>
          <button
            onClick={() => onLeave?.()}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: `1px solid #ef4444`,
              background: '#ef4444',
              color: '#0b0b0b',
              cursor: 'pointer',
              fontWeight: 800
            }}
            title="Sair da sala"
          >
            Sair
          </button>
        </div>
      </div>

      {/* Faixa de círculos de quem está falando (aparece só enquanto fala) */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center',
        minHeight: 44, marginBottom: 8, padding: '6px 8px',
        borderRadius: 12, border: `1px solid ${theme.accent}33`,
        background: '#0b0b0b',
      }}>
        {speakingCircles.length ? speakingCircles : (
          <div style={{ fontSize: 12, opacity: 0.6 }}>Ninguém falando agora…</div>
        )}
      </div>

      {/* Status */}
      <div style={{ ...cardStyle, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>Status</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {status}{error ? ` — ${error}` : ''}
          </div>
        </div>
      </div>

      {/* Grid do time — sliders (80% default) desabilitam quando não conectado */}
      <div style={{ ...cardStyle }}>
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700 }}>Seu Time</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Conectados: {remoteNames.length}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12
        }}>
          {teammates.map((t, idx) => {
            const name = t.name || `Jogador ${idx + 1}`
            const nameLower = (name || '').toLowerCase()
            const img = champTile(t.championName, t.skinIndex ?? 0)
            const connected = connectedSet.has(nameLower)
            const speaking = connected && isSpeaking(name)
            const sliderDisabled = !connected
            const userVol = userVolume[nameLower] ?? 0.8
            const isUserMuted = mutedUsers.has(nameLower)

            return (
              <div key={name + idx} style={{
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 14,
                border: `1px solid ${connected ? theme.accent : '#ffffff1a'}`,
                boxShadow: speaking ? `0 0 0 2px ${theme.ring}, 0 0 18px ${theme.ring}55 inset` : 'none',
                background: '#0b0b0b',
              }}>
                <div style={{
                  height: 86,
                  backgroundImage: img ? `url(${img})` : 'none',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: connected ? 'none' : 'grayscale(100%) brightness(0.6)',
                }} />
                <div style={{ padding: '10px 12px', display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                        {name}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.8 }}>
                        {t.championName || '—'}
                      </div>
                    </div>
                    <div style={{
                      width: 10, height: 10, borderRadius: 999,
                      background: speaking ? theme.ring : (connected ? '#16a34a' : '#6b7280'),
                      boxShadow: speaking ? `0 0 12px ${theme.ring}` : 'none'
                    }} />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="range"
                      min={0} max={1} step={0.01}
                      value={userVol}
                      onChange={(e) => handleUserVolume(name, Number(e.target.value))}
                      disabled={sliderDisabled}
                      style={{ flex: 1 }}
                      title={`Volume de ${name}`}
                    />
                    <button
                      onClick={() => handleMuteUser(name)}
                      disabled={!connected}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: `1px solid ${isUserMuted ? theme.accent : '#ffffff22'}`,
                        background: isUserMuted ? '#00000055' : '#111',
                        color: isUserMuted ? theme.accent : theme.text,
                        cursor: connected ? 'pointer' : 'not-allowed',
                        fontSize: 12, fontWeight: 700
                      }}
                      title={isUserMuted ? 'Desmutar usuário' : 'Mutar usuário'}
                    >
                      {isUserMuted ? 'Desmutar' : 'Mutar'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
