import { ElectronAPI } from '@electron-toolkit/preload'
import type { MainApi } from '@shared/rpcTree.gen'

declare global {
  interface Window {
    mainApi: MainApi
    electron: ElectronAPI
    api: unknown
  }
} 