import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import WebSocket from 'ws'

let mainWindow: BrowserWindow | null = null
let rconSocket: WebSocket | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ----------------------------------------------------
// Rust WebRCON 実装
// ----------------------------------------------------

ipcMain.handle('rcon-connect', async (_event, config) => {
  const { host, port, password } = config

  if (rconSocket) {
    try { rconSocket.close() } catch (e) {}
    rconSocket = null
  }

  const url = `ws://${host}:${port}/${password}`
  console.log(`[Main] Connecting to ${host}:${port}...`)

  try {
    rconSocket = new WebSocket(url)

    rconSocket.on('open', () => {
      console.log('[Main] RCON WebSocket Open')
      mainWindow?.webContents.send('rcon-connected')
    })

    rconSocket.on('message', (data) => {
      try {
        const messageStr = data.toString()
        const parsed = JSON.parse(messageStr)
        
        if (parsed.Message) {
           mainWindow?.webContents.send('rcon-log', parsed.Message)
           mainWindow?.webContents.send('rcon-message', parsed)
        } else {
           mainWindow?.webContents.send('rcon-log', messageStr)
        }
      } catch (e) {
        mainWindow?.webContents.send('rcon-log', data.toString())
      }
    })

    rconSocket.on('error', (err) => {
      console.error('[Main] RCON Error:', err.message)
      mainWindow?.webContents.send('rcon-error', err.message)
    })

    rconSocket.on('close', (code, reason) => {
      console.log(`[Main] RCON Closed: ${code} ${reason}`)
      mainWindow?.webContents.send('rcon-disconnected')
      rconSocket = null
    })

  } catch (error: any) {
    console.error('[Main] Connection setup failed:', error)
    mainWindow?.webContents.send('rcon-error', error.message || 'Connection setup failed')
  }
})

ipcMain.handle('rcon-disconnect', async () => {
  if (rconSocket) {
    rconSocket.close()
    rconSocket = null
  }
  return true
})

ipcMain.handle('rcon-send', async (_event, command) => {
  if (rconSocket && rconSocket.readyState === WebSocket.OPEN) {
    const packet = JSON.stringify({
      Identifier: 1001,
      Message: command,
      Name: 'WebRcon'
    })
    rconSocket.send(packet)
    return true
  }
  return false
})

// ----------------------------------------------------
// ★修正: 最強のGeoIPロジック (3段構え)
// ----------------------------------------------------
ipcMain.handle('get-geo', async (_event, rawIp) => {
  // 1. IPの整形 (ポート番号削除)
  const ip = rawIp ? rawIp.split(':')[0] : '';

  // ローカルIPはスキップ
  if (!ip || ip.includes('127.0.0.1') || ip.includes('192.168.') || ip === 'localhost') {
    return { country: 'Local', countryCode: '' }
  }

  console.log(`[Main] Fetching Geo for IP: ${ip}`);

  // 【プランA】 ipwho.is (HTTPS, 高速)
  try {
    const res = await fetch(`https://ipwho.is/${ip}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        console.log(`[Main] Geo Success (Plan A): ${data.country}`);
        return { country: data.country, countryCode: data.country_code, city: data.city };
      }
    }
  } catch (e) { console.error('[Main] Plan A failed:', e) }

  // 【プランB】 ip-api.com (HTTP, 老舗・確実)
  // ※Mainプロセス(Node.js)ならHTTPでも混在コンテンツエラーにならず通信可能です
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'success') {
        console.log(`[Main] Geo Success (Plan B): ${data.country}`);
        return { country: data.country, countryCode: data.countryCode, city: data.city };
      }
    }
  } catch (e) { console.error('[Main] Plan B failed:', e) }

  // 【プランC】 ipapi.co (JSON, バックアップ)
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`);
    if (res.ok) {
      const data = await res.json();
      if (data.country_name) {
        console.log(`[Main] Geo Success (Plan C): ${data.country_name}`);
        return { country: data.country_name, countryCode: data.country_code, city: data.city };
      }
    }
  } catch (e) { console.error('[Main] Plan C failed:', e) }

  console.warn(`[Main] All GeoIP plans failed for ${ip}`);
  return { country: 'Unknown', countryCode: '' }
})

// ----------------------------------------------------

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})