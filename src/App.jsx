import React, { useEffect, useState, useCallback } from 'react'
import VoiceRoom from './VoiceRoom'
import { getBackendUrl } from '../utils/backend'


const backendUrl = getBackendUrl()
const brand = {
  bg: 'linear-gradient(180deg, #0b0b0b 0%, #0f0f0f 60%, #0b0b0b 100%)',
  card: '#151515',
  text: '#f2f2f2',
  sub: '#b3b3b3',
  accent: '#ff6a00', // laranja
  border: '#262626',
}

export default function App() {

  const [presence, setPresence] = useState({ inGame: false })
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    if (!presence.inGame || !presence.ready) {
      setJoined(false) // sai da UI de voz quando acaba a partida
    }
  }, [presence.inGame, presence.ready])


  useEffect(() => {
    const off = window.voiceAPI?.onPresenceUpdate?.((p) => setPresence(p))
    return () => off && off()
  }, [])

  const canJoin = presence?.inGame && presence?.ready && !joined
  const handleJoin = useCallback(() => setJoined(true), [])

  // preview simples de roster (se já veio)
  const teamList =
    (Array.isArray(presence.teamRoster) && presence.teamRoster.length)
      ? presence.teamRoster
      : (Array.isArray(presence.names) ? presence.names.map(n => ({ name: n })) : [])

  const teamLabel =
    presence.team === 'ORDER' ? 'Time Azul'
      : presence.team === 'CHAOS' ? 'Time Vermelho'
        : '-'

  const styles = {
    app: {
      height: '100vh',
      background: brand.bg,
      color: brand.text,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: `Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif`,
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
    },
    titlebar: {
      WebkitAppRegion: 'drag',
      height: 44,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      background: '#0c0c0c',
      borderBottom: `1px solid ${brand.border}`,
    },
    title: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontWeight: 800,
      letterSpacing: 0.4,
    },
    dot: {
      width: 10, height: 10, borderRadius: 999, background: brand.accent, boxShadow: `0 0 8px ${brand.accent}aa`
    },
    winBtns: {
      WebkitAppRegion: 'no-drag',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    },
    btn: {
      width: 36, height: 28, borderRadius: 8, border: `1px solid ${brand.border}`,
      background: '#121212', color: brand.text, cursor: 'pointer',
    },
    content: {
      flex: 1,
      padding: 18,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    card: {
      width: 920,
      maxWidth: '96vw',
      border: `1px solid ${brand.border}`,
      background: brand.card,
      borderRadius: 18,
      padding: 18,
      boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
    },
    headerRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    pill: {
      fontSize: 12,
      color: '#111',
      background: brand.accent,
      padding: '6px 12px',
      borderRadius: 999,
      fontWeight: 800,
      letterSpacing: 0.4,
    },
    status: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
    },
    statBox: {
      border: `1px solid ${brand.border}`,
      background: '#101010',
      borderRadius: 14,
      padding: 14,
      minHeight: 92,
    },
    k: { fontSize: 12, color: brand.sub },
    v: { fontSize: 16, fontWeight: 700, marginTop: 4 },
    ctaRow: {
      marginTop: 14,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
    },
    cta: (enabled) => ({
      padding: '10px 16px',
      borderRadius: 10,
      border: `1px solid ${enabled ? brand.accent : brand.border}`,
      background: enabled ? brand.accent : '#0f0f0f',
      color: enabled ? '#0b0b0b' : brand.sub,
      fontWeight: 800,
      letterSpacing: 0.4,
      cursor: enabled ? 'pointer' : 'not-allowed',
      transition: 'transform .06s ease',
    }),
    footer: {
      height: 36,
      borderTop: `1px solid ${brand.border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: brand.sub,
      fontSize: 12,
    }
  }

  return (
    <div style={styles.app}>
      {/* Titlebar (drag) */}
      <div style={styles.titlebar}>
        <div style={styles.title}>
          <div style={styles.dot} />
          <div style={{ fontSize: 14 }}>Swell Voice</div>
        </div>
        <div style={styles.winBtns}>
          <button style={styles.btn} onClick={() => window.windowAPI?.minimize()}>—</button>
          <button style={{ ...styles.btn, borderColor: brand.accent }} onClick={() => window.windowAPI?.close()}>✕</button>
        </div>
      </div>

      {/* Conteúdo */}
      <div style={styles.content}>
        {!joined ? (
          <div style={styles.card}>
            <div style={styles.headerRow}>
              <div>
                <div style={{ fontSize: 12, color: brand.sub }}>Status</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  {presence.inGame ? 'Em partida' : 'Fora de partida'}
                </div>
              </div>
              <div style={styles.pill}>Swell Voice</div>
            </div>

            <div style={styles.status}>
              <div style={styles.statBox}>
                <div style={styles.k}>Time</div>
                <div style={styles.v}>{presence.inGame ? (presence.team || '-') : '-'}</div>
                <div style={{ marginTop: 8, fontSize: 12, color: brand.sub }}>
                  {presence.team === 'ORDER' ? 'Time Azul' : presence.team === 'CHAOS' ? 'Time Vermelho' : '-'}
                </div>
              </div>

              <div style={styles.statBox}>
                <div style={styles.k}>Sala (determinística)</div>
                <div style={{ ...styles.v, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontWeight: 600 }}>
                  {presence.inGame ? (presence.roomName || '—') : '—'}
                </div>
              </div>
            </div>

            {presence.inGame && (teamList?.length > 0) && (
              <div style={{ marginTop: 12, border: `1px solid ${brand.border}`, borderRadius: 14, padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Seu time</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {teamList.map((p, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 12,
                        color: brand.sub,
                        padding: '6px 10px',
                        border: `1px solid ${brand.border}`,
                        borderRadius: 999
                      }}
                    >
                      {p.name} {p.championName ? `— ${p.championName}` : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={styles.ctaRow}>
              <button
                disabled={!canJoin}
                onClick={handleJoin}
                style={styles.cta(!!canJoin)}
                onMouseDown={(e) => { if (canJoin) e.currentTarget.style.transform = 'scale(0.98)' }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
              >
                Entrar na voz do time
              </button>
            </div>
          </div>
        ) : (
          <div style={{ width: 'min(1120px, 96vw)' }}>
            <VoiceRoom
              backendUrl="https://lol-voice.onrender.com"
              roomName={presence.roomName}
              displayName={presence.identityName}
              team={presence.team}
              teammates={
                (presence.teamRoster?.length ? presence.teamRoster :
                  (presence.names?.map(n => ({ name: n })) || [])
                )
              }
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>Developed by Feelx</div>
    </div>
  )
}
