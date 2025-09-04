import React, { useEffect, useRef, useState, useMemo } from 'react'
import { Room, RoomEvent, createLocalTracks, Track } from 'livekit-client'

// URL versionless do tile/splash (leve e estável)
function champTile(championName, skinIndex = 0) {
  if (!championName) return null
  // Ajustes simples de nomes com apóstrofo/espaços — maioria dos casos já funciona
  const safe = String(championName)
    .replaceAll("'", '')
    .replaceAll(' ', '')
    .replaceAll('.', '')
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/tiles/${safe}_${skinIndex}.jpg`
}

function useThemeByTeam(team) {
  // ORDER -> Azul; CHAOS -> Vermelho
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

export default function VoiceRoom({ backendUrl, roomName, displayName, team, teammates = [] }) {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [muted, setMuted] = useState(false)
  const [activeSpeakers, setActiveSpeakers] = useState([]) // identities
  const [remoteNames, setRemoteNames] = useState([]) // nomes conectados na sala (sem local)

  const roomRef = useRef(null)
  const audioElsRef = useRef(new Map()) // Map<id, HTMLAudioElement>

  const theme = useThemeByTeam(team)
  const headerGlow = `0 0 20px ${theme.accent}55, 0 0 40px ${theme.accent}33`

  // --- helpers compat ---
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
  const attachAudio = (track) => {
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

  // participantes conectados (nomes)
  const refreshParticipants = () => {
    const room = roomRef.current
    if (!room) return
    const remotes = getRemoteMap(room)
    const names = []
    for (const p of remotes.values()) {
      names.push(p.name || p.identity)
    }
    setRemoteNames(names)
  }

  // quem está falando (para glow)
  const onActiveSpeakers = () => {
    const room = roomRef.current
    if (!room || !room.activeSpeakers) return
    const ids = room.activeSpeakers.map(s => s.participant?.name || s.participant?.identity).filter(Boolean)
    setActiveSpeakers(ids)
  }

  // ---- lifecycle ----
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

          room.on(RoomEvent.ParticipantConnected, () => {
            refreshParticipants()
          })
          room.on(RoomEvent.ParticipantDisconnected, (p) => {
            for (const pub of iterPublications(p)) {
              const t = pub?.track ?? pub?.audioTrack ?? pub?.videoTrack
              if (t) detachAudio(t)
            }
            refreshParticipants()
          })
          room.on(RoomEvent.TrackSubscribed, (track) => {
            attachAudio(track)
            refreshParticipants()
          })
          room.on(RoomEvent.TrackUnsubscribed, (track) => {
            detachAudio(track)
            refreshParticipants()
          })
          room.on(RoomEvent.ActiveSpeakersChanged, () => {
            onActiveSpeakers()
          })

          await room.connect(url, token, { autoSubscribe: true })

          // publica mic
          const tracks = await createLocalTracks({ audio: true, video: false })
          const mic = tracks.find(t => t.kind === Track.Kind.Audio)
          if (mic) await room.localParticipant.publishTrack(mic)

          // anexa quem já estava
          const remotes = getRemoteMap(room)
          for (const p of remotes.values()) {
            for (const pub of iterPublications(p)) {
              const t = pub?.track ?? pub?.audioTrack ?? pub?.videoTrack
              const kind = t?.kind ?? pub?.kind
              const subscribed = pub?.isSubscribed ?? true
              if (subscribed && t && kind === Track.Kind.Audio) {
                attachAudio(t)
              }
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
      if (room) {
        try {
          for (const el of audioElsRef.current.values()) el.remove()
          audioElsRef.current.clear()
          room.disconnect()
        } catch { }
      }
      roomRef.current = null
    }
  }, [backendUrl, roomName, displayName])

  const toggleMute = async () => {
    try {
      const room = roomRef.current
      if (!room) return
      const pubs = iterPublications(room.localParticipant)
      const pub = pubs.find(tp => (tp?.kind ?? tp?.track?.kind) === Track.Kind.Audio)
      if (!pub) return
      if (typeof pub.mute === 'function' && typeof pub.unmute === 'function') {
        if (muted) await pub.unmute()
        else await pub.mute()
      } else {
        const t = pub.track
        if (!t) return
        if (muted) await t.enable()
        else await t.disable()
      }
      setMuted(!muted)
    } catch { }
  }

  // match: teammate (LoL) x participante (LiveKit) por nome, case-insensitive
  const connectedSet = useMemo(() => {
    return new Set(remoteNames.map(n => (n || '').toLowerCase()))
  }, [remoteNames])

  const isSpeaking = (name) => activeSpeakers.some(n => (n || '').toLowerCase() === (name || '').toLowerCase())

  // estilos util
  const cardStyle = {
    background: theme.card,
    border: `1px solid ${theme.accent}33`,
    borderRadius: 16,
    padding: 16,
  }
  const chipStyle = {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 999,
    background: theme.chipBg,
    color: theme.chipText,
    fontSize: 12,
    letterSpacing: 0.4,
    border: `1px solid ${theme.accent}55`,
  }

  return (
    <div style={{
      background: theme.bg,
      color: theme.text,
      borderRadius: 20,
      padding: 18,
      border: `1px solid ${theme.accent}40`,
      boxShadow: headerGlow,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Sala</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{roomName}</div>
        </div>
        <div style={chipStyle}>
          {team === 'ORDER' ? 'TIME AZUL' : 'TIME VERMELHO'}
        </div>
      </div>

      {/* Status + Controls */}
      <div style={{ ...cardStyle, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>Status</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {status}{error ? ` — ${error}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
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
          >
            {muted ? 'Desmutar' : 'Mutar'}
          </button>
        </div>
      </div>

      {/* Grid do time com ícones de campeões */}
      <div style={{ ...cardStyle }}>
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700 }}>Seu Time</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Conectados: {remoteNames.length}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12
        }}>
          {teammates.map((t, idx) => {
            const name = t.name || `Jogador ${idx + 1}`
            const img = champTile(t.championName, t.skinIndex ?? 0)
            const connected = connectedSet.has((name || '').toLowerCase())
            const speaking = connected && isSpeaking(name)
            return (
              <div key={name + idx} style={{
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 14,
                border: `1px solid ${connected ? theme.accent : '#ffffff1a'}`,
                boxShadow: speaking ? `0 0 0 2px ${theme.ring}, 0 0 18px ${theme.ring}55 inset` : 'none',
              }}>
                <div style={{
                  height: 86,
                  background: '#0b0b0b',
                  backgroundImage: img ? `url(${img})` : 'none',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: connected ? 'none' : 'grayscale(100%) brightness(0.6)',
                }} />
                <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
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
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
