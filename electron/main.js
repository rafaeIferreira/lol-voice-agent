
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

let fallbackMatchId = null
let lastGameEndAt = 0
const GAME_END_GRACE_MS = 15000

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
        fallbackMatchId = 'local-' + Date.now()
        lastGameEndAt = 0
        console.log('Novo fallbackMatchId:', fallbackMatchId)
      }
    }
    if (ev.EventName === 'GameEnd') {
      lastGameEndAt = Date.now()
      console.log('GameEnd recebido, inicia período de graça…')
      // NÃO zere o fallbackMatchId aqui. Espere o grace no polling.
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



function computeRoomFromTeam(data) {
  const team = data.team
  let matchId = data.gameId ?? fallbackMatchId
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
    frame: false,                    // <— sem bordas
    autoHideMenuBar: true,           // <— esconde menu (Windows/Linux)
    titleBarStyle: 'hidden',         // <— macOS
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
  //teste
  mainWindow.webContents.openDevTools({ mode: 'detach' })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log('did-fail-load', code, desc, url)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('render-process-gone', details)
  })

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

      // Se recebemos GameEnd, respeite o grace antes de “apagar” tudo
      if (lastGameEndAt && Date.now() - lastGameEndAt > GAME_END_GRACE_MS) {
        fallbackMatchId = null
        lastGameEndAt = 0
        // Força pro “fora de partida”
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
  const backend =
    payload.backendUrl ||
    'https://lol-voice.onrender.com'



  if (!payload?.roomName) {
    const msg = 'Sem sala disponível (parece que você não está em partida).'
    dialog.showErrorBox('Join bloqueado', msg)
    throw new Error(msg)
  }
  console.log(">>> VOICE:JOIN chamando backend:", backend)
  try {
    const res = await axios.post(backend + '/join', {
      room: payload.roomName,
      identity,
      name: payload.identityName || identity
    }, { timeout: 5000 })

    return res.data
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
