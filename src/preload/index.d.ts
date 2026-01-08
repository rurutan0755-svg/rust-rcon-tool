import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      connectRcon: (config: any) => Promise<any>
      sendRconCommand: (command: string) => Promise<any>
      onRconLog: (callback: (log: string) => void) => void
      onRconStatus: (callback: (status: string) => void) => void
      removeAllListeners: () => void
    }
  }
}