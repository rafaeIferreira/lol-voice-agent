
import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { setInterval as safeInterval, clearInterval } from 'node:timers'
import axios from 'axios'
import https from 'https'
import { fileURLToPath } from 'url'


// Corrige __filename e __dirname no ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let fallbackMatchId = getCurrentMatchId()

let lastGameEndAt = 0
const GAME_END_GRACE_MS = 15000
const httpsKeepAlive = new https.Agent({ keepAlive: true })

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function wakeBackend(base) {
  // tenta acordar o Render (free tier “dorme”)
  try {
    await axios.get(base + '/health', { timeout: 8000, httpsAgent: httpsKeepAlive })
  } catch {}
}

async function postJoinWithRetry(base, body) {
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(base + '/join', body, {
        timeout: 20000,              // ↑ 20s
        httpsAgent: httpsKeepAlive,
      })
      return res.data
    } catch (e) {
      const status = e?.response?.status
      const retriable =
        e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' ||
        !status || [429, 500, 502, 503, 504].includes(status)

      if (attempt < maxAttempts && retriable) {
        await sleep(1000 * attempt * attempt) // backoff 1s, 4s
        continue
      }
      throw e
    }
  }
}

function getStore() {
  try { return JSON.parse(fs.readFileSync(storePath, 'utf-8')) } catch { return {} }
}
function setStore(next) {
  fs.writeFileSync(storePath, JSON.stringify(next, null, 2))
}
function getCurrentMatchId() {
  const st = getStore()
  return st.currentMatchId || null
}
function setCurrentMatchId(id) {
  const st = getStore()
  st.currentMatchId = id
  setStore(st)
}
function clearCurrentMatchId() {
  const st = getStore()
  delete st.currentMatchId
  setStore(st)
}


function normalizeId(p) {
  if (!p) return ''
  // prioriza riotId; senão monta gameName#tag; senão summonerName
  const id = p.riotId || (p.riotIdGameName && p.riotIdTagLine
    ? `${p.riotIdGameName}#${p.riotIdTagLine}`
    : p.summonerName)
  return (id || '').toLowerCase()
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL
const isDev = !!DEV_URL
let mainWindow
let pollTimer = null

// Simple storage in userData
const storePath = path.join(app.getPath('userData'), 'lolvoice-store.json')

function handleEvents(events) {
  if (!events?.Events) return
  for (const ev of events.Events) {
    if (ev.EventName === 'GameStart') {
      if (!fallbackMatchId) {
        fallbackMatchId = getCurrentMatchId() || ('local-' + Date.now())
        setCurrentMatchId(fallbackMatchId)
        lastGameEndAt = 0
        console.log('Novo fallbackMatchId (persistido):', fallbackMatchId)
      }
    }
    if (ev.EventName === 'GameEnd') {
      lastGameEndAt = Date.now()
      console.log('GameEnd recebido, inicia período de graça…')
    }
  }
}


function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf-8'))
  } catch (e) { return {} }
}
function saveStore(obj) {
  fs.writeFileSync(storePath, JSON.stringify(obj, null, 2))
}
function getIdentity() {
  const st = loadStore()
  if (st.identity) return st.identity
  const id = crypto.randomUUID()
  st.identity = id
  saveStore(st)
  return id
}

function hashRoomKey(strings) {
  const input = strings.join('|')
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 12)
}

async function getLiveClientData() {
  try {
    const url = 'https://127.0.0.1:2999/liveclientdata/allgamedata'
    const agent = new https.Agent({ rejectUnauthorized: false })

    console.log('Requesting:', url)
    const res = await axios.get(url, { timeout: 5000, httpsAgent: agent })
    console.log('Response OK')

    const { activePlayer, allPlayers, gameData } = res.data || {}

    const me = allPlayers?.find(p =>
      p.summonerName?.toLowerCase() === activePlayer?.summonerName?.toLowerCase()
    ) || activePlayer || allPlayers?.[0]

    const team = me?.team || activePlayer?.team || null
    const gameId = gameData?.gameId ?? null

    console.log("ALLGAMEDATA", JSON.stringify(res.data, null, 2))
    console.log("ME", me, "TEAM", team, "GAMEID", gameId)

    return { ok: true, team, gameId, gameData, activePlayer, players: allPlayers || [] }
  } catch (e) {
    console.error("Erro no getLiveClientData:", e.code, e.message)
    return { ok: false, error: String(e?.message || e) }
  }
}

function rosterSignature(players, team) {
  return (players || [])
    .filter(p => p.team === team)
    .map(p => (p.riotId || p.summonerName || '').toLowerCase())
    .sort()
    .join('|')
}

function stableMatchKey(gameId, players, team) {
  if (gameId) return String(gameId)
  const sig = rosterSignature(players, team) || 'unknown'
  return 'sig-' + crypto.createHash('sha1').update(sig).digest('hex').slice(0,12)
}



function computeRoomFromTeam(data) {
  const team = data.team
  let matchId = stableMatchKey(data.gameId, data.players, data.team) ?? fallbackMatchId

  if (!team || !matchId) return null

  const roomName = `lolvoice-${matchId}-${team}`

  const identityName =
    data.activePlayer?.riotId ||
    data.activePlayer?.summonerName ||
    os.userInfo().username

  // monta roster do seu time: nome + campeão + skin
  const roster = (data.players || [])
    .filter(p => p.team === team)
    .map(p => ({
      name: p.riotId || p.summonerName,
      championName: p.championName,       // ex: "Thresh"
      skinIndex: p.skinID ?? 0,           // ex: 0 -> splash/tiles _0
    }))

  return { roomName, names: roster.map(r => r.name), identityName, team, roster }
}





async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    frame: false,                    
    autoHideMenuBar: true,           
    titleBarStyle: 'hidden',         
    backgroundColor: '#0b0b0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  Menu.setApplicationMenu(null)

  if (isDev) {
    await mainWindow.loadURL(DEV_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  startPolling()
}

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:close', () => mainWindow?.close())

function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    try {
      const base = "https://127.0.0.1:2999/liveclientdata"
      const agent = new https.Agent({ rejectUnauthorized: false })

      const all = await axios.get(base + "/allgamedata", { timeout: 3000, httpsAgent: agent })
      const { activePlayer, allPlayers, gameData } = all.data || {}

      const me = allPlayers?.find(p => p.summonerName === activePlayer?.summonerName) || allPlayers?.[0]
      const team = me?.team || activePlayer?.team || null
      const gameId = gameData?.gameId ?? null

      // Deriva a sala
      const derived = computeRoomFromTeam({ team, gameId, activePlayer, players: allPlayers })
      if (derived) {
        mainWindow.webContents.send("presence:update", {
          inGame: true, team: derived.team, ready: true,
          roomName: derived.roomName, identityName: derived.identityName, names: derived.names
        })
      } else {
        mainWindow.webContents.send("presence:update", { inGame: true, team, ready: false })
      }

      // Eventos (para GameStart/GameEnd)
      const events = await axios.get(base + "/eventdata", { httpsAgent: agent })
      handleEvents(events.data)

      if (lastGameEndAt && Date.now() - lastGameEndAt > GAME_END_GRACE_MS) {
        fallbackMatchId = null
        clearCurrentMatchId()
        lastGameEndAt = 0
        mainWindow.webContents.send("presence:update", { inGame: false, ready: false })
      }


    } catch (e) {
      // Não há mais API (cliente fechou a partida): fora de jogo
      mainWindow.webContents.send("presence:update", { inGame: false, ready: false, error: String(e.message || e) })
      // Se já passou o grace, limpe fallback
      if (lastGameEndAt && Date.now() - lastGameEndAt > GAME_END_GRACE_MS) {
        fallbackMatchId = null
        lastGameEndAt = 0
      }
    }
  }, 2000)
}



ipcMain.handle('voice:get-identity', async () => {
  return { identity: getIdentity() }
})

ipcMain.handle('voice:join', async (_evt, payload) => {
  const identity = getIdentity()
  const backend = payload.backendUrl || 'https://lol-voice.onrender.com'

  if (!payload?.roomName) {
    const msg = 'Sem sala disponível (parece que você não está em partida).'
    dialog.showErrorBox('Join bloqueado', msg)
    throw new Error(msg)
  }

  const body = {
    room: payload.roomName,
    identity,
    name: payload.identityName || identity
  }

  try {
    await wakeBackend(backend)                    // “acorda” o Render
    const data = await postJoinWithRetry(backend, body)  // tenta com retry
    return data
  } catch (e) {
    dialog.showErrorBox('Join error', String(e?.response?.data?.error || e.message || e))
    throw e
  }
})

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
