// src/Overlay.jsx
import React, { useEffect, useMemo, useState } from 'react'

// mesmo helper dos tiles do LoL
function champTile(championName, skinIndex = 0) {
  if (!championName) return null
  const safe = String(championName).replaceAll("'", '').replaceAll(' ', '').replaceAll('.', '')
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/tiles/${safe}_${skinIndex}.jpg`
}

const theme = {
  panelBg: 'rgba(10,10,10,0.72)',
  panelBorder: 'rgba(255,106,0,0.32)',
  text: '#f5f5f5',
  sub: '#cfcfcf',
  accent: '#ff6a00',
  ring: 'rgba(255,106,0,0.85)',
}

function fmtTime(sec) {
  if (!sec || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function Overlay() {
  const [presence, setPresence] = useState({ inGame: false })
  const [ov, setOv] = useState({ activeSpeakers: [], remoteNames: [] })

  useEffect(() => {
    const off = window.voiceAPI?.onPresenceUpdate?.(p => setPresence(p))
    const off2 = window.overlayAPI?.onOverlayState?.(s => setOv(s || {}))
    return () => { off && off(); off2 && off2() }
  }, [])

  const connectedSet = useMemo(() => new Set((ov.remoteNames || []).map(n => (n || '').toLowerCase())), [ov.remoteNames])
  const speakingSet = useMemo(() => new Set((ov.activeSpeakers || []).map(n => (n || '').toLowerCase())), [ov.activeSpeakers])

  const roster = Array.isArray(presence.teamRoster) ? presence.teamRoster : []
  const showLobby = !presence.inGame

  // container estilo discord (coluna)
  const wrap = {
    position: 'fixed', inset: '8px 8px auto auto', // canto superior direito
    width: 260,
    background: theme.panelBg,
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 14,
    color: theme.text,
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    boxShadow: '0 12px 50px rgba(0,0,0,0.45)',
    userSelect: 'none',
    fontFamily: `Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`,
  }

  const header = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 10px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)'
  }

  const pill = {
    padding: '4px 8px', borderRadius: 999, fontSize: 11, letterSpacing: .3, fontWeight: 800,
    background: 'rgba(255,106,0,0.15)', color: theme.accent, border: `1px solid ${theme.panelBorder}`
  }

  const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }
  const avatarWrap = (speaking, connected) => ({
    width: 36, height: 36, borderRadius: 999, overflow: 'hidden',
    border: `2px solid ${speaking ? theme.ring : (connected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)')}`,
    boxShadow: speaking ? `0 0 14px ${theme.ring}` : 'none',
    background: '#0b0b0b',
    flex: '0 0 auto'
  })
  const nameStyle = (connected) => ({
    fontSize: 13, fontWeight: 700, color: connected ? theme.text : '#8a8a8a',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160
  })
  const sub = { fontSize: 11, color: theme.sub, opacity: .8 }

  // Header content
  const statusText = showLobby ? 'Saguão' : (presence.team === 'ORDER' ? 'Time Azul' : presence.team === 'CHAOS' ? 'Time Vermelho' : 'Em partida')
  const matchLine = showLobby
    ? 'Aguardando partida…'
    : `${fmtTime(presence.matchTimeSec || 0)} • ${presence.mode || '—'} • ${presence.map || '—'}`

  return (
    <div style={wrap}>

      {/* Header */}
      <div style={header}>
        <div>
          <div style={{ fontSize: 12, opacity: .9 }}>{statusText}</div>
          <div style={{ fontSize: 11, color: theme.sub }}>{matchLine}</div>
        </div>
        <div style={pill}>Swell</div>
      </div>

      {/* Lista de participantes (estilo Discord) */}
      <div style={{ padding: '6px 0' }}>
        {roster.length === 0 && (
          <div style={{ padding: '10px', fontSize: 12, color: '#bdbdbd' }}>
            Sem jogadores detectados.
          </div>
        )}
        {roster.map((t, idx) => {
          const name = t.name || `Jogador ${idx + 1}`
          const key = name + idx
          const connected = connectedSet.has((name || '').toLowerCase())
          const speaking = speakingSet.has((name || '').toLowerCase())
          const tile = champTile(t.championName, t.skinIndex ?? 0)
          return (
            <div key={key} style={{ ...row, opacity: 1 }}>
              <div style={avatarWrap(speaking, connected)}>
                <div style={{
                  width: '100%', height: '100%',
                  backgroundImage: tile ? `url(${tile})` : 'none',
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  filter: connected ? 'none' : 'grayscale(100%) brightness(0.6)'
                }} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={nameStyle(connected)} title={name}>{name}</div>
                <div style={sub}>{t.championName || '—'}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer mini instruções */}
      <div style={{ padding: '6px 10px 8px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 10, color: '#bdbdbd' }}>Overlay • Dark</div>
        <button
          onClick={() => window.overlayAPI?.toggleClickThrough?.(true)}
          onMouseDown={(e) => e.currentTarget.style.transform = 'scale(.98)'}
          onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
          style={{
            fontSize: 10, fontWeight: 800,
            background: 'transparent', color: theme.accent,
            border: `1px solid ${theme.panelBorder}`, borderRadius: 8, padding: '4px 8px', cursor: 'pointer'
          }}
          title="Permitir clicar através (para jogos)"
        >
          Click-through
        </button>
      </div>
    </div>
  )
}
