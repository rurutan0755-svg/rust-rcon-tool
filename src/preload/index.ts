import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 画面側(Renderer)に提供するAPIの定義
const api = {
  // --- メソッド (画面から裏側への命令) ---
  connectRcon: (config): Promise<void> => ipcRenderer.invoke('rcon-connect', config),
  disconnectRcon: (): Promise<void> => ipcRenderer.invoke('rcon-disconnect'),
  sendRconCommand: (command: string): Promise<boolean> => ipcRenderer.invoke('rcon-send', command),
  getGeo: (ip: string): Promise<any> => ipcRenderer.invoke('get-geo', ip),

  // --- イベント (裏側から画面への通知) ---
  // callback関数を受け取って、イベントが来たら実行する
  onRconConnected: (callback): void => {
    ipcRenderer.on('rcon-connected', (_event, value) => callback(value))
  },
  onRconDisconnected: (callback): void => {
    ipcRenderer.on('rcon-disconnected', (_event, value) => callback(value))
  },
  onRconError: (callback): void => {
    ipcRenderer.on('rcon-error', (_event, value) => callback(value))
  },
  onRconLog: (callback): void => {
    ipcRenderer.on('rcon-log', (_event, value) => callback(value))
  },
  onRconMessage: (callback): void => {
    ipcRenderer.on('rcon-message', (_event, value) => callback(value))
  },
  // 旧互換用
  onRconStatus: (callback): void => {
    ipcRenderer.on('rcon-status', (_event, value) => callback(value))
  },

  // --- クリーンアップ ---
  removeAllListeners: (): void => {
    ipcRenderer.removeAllListeners('rcon-connected')
    ipcRenderer.removeAllListeners('rcon-disconnected')
    ipcRenderer.removeAllListeners('rcon-error')
    ipcRenderer.removeAllListeners('rcon-log')
    ipcRenderer.removeAllListeners('rcon-message')
    ipcRenderer.removeAllListeners('rcon-status')
  }
}

// APIを画面側に公開する処理
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (types)
  window.electron = electronAPI
  // @ts-ignore (types)
  window.api = api
}