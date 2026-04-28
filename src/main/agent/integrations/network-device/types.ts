import type { HostInfo } from '@shared/ExtensionMessage'
import type { SendInputResult } from '../../services/interaction-detector/types'
import type { SwitchBrand } from '@core/prompts/switch-prompts'

export type NetworkDeviceAssetType = 'person-switch-cisco' | 'person-switch-huawei'

export type CommandSafety = 'read-only' | 'configuration' | 'destructive' | 'interactive'

export interface NetworkDeviceConnectionInfo {
  host?: string
  hostname?: string
  port?: number
  username?: string
  password?: string
  privateKey?: string
  passphrase?: string
  asset_type?: string
  sshType?: string
  needProxy: boolean
  proxyName?: string
  ident?: string
  proxyCommand?: string
  wakeupTabId?: string
}

export interface NetworkDeviceTerminalInfo {
  id: number
  sessionId: string
  busy: boolean
  lastCommand: string
  connectionInfo: NetworkDeviceConnectionInfo
  terminal: {
    show: () => void
  }
}

export interface NetworkDeviceProcessEvents extends Record<string, any[]> {
  line: [line: string]
  continue: []
  completed: []
  error: [error: Error]
  no_shell_integration: []
}

export interface NetworkDeviceCommandPlan {
  normalizedCommand: string
  safety: CommandSafety
  requiresApproval: boolean
  interactive: boolean
}

export interface NetworkDevicePromptState {
  prompt: string
  mode: 'exec' | 'privileged' | 'configuration' | 'unknown'
}

export interface NetworkDeviceExecutionContext {
  taskId?: string
  hostInfo?: HostInfo
}

export interface NetworkDeviceProcessPromise extends Promise<void> {
  on(event: 'line', listener: (line: string) => void): this
  once(event: 'completed' | 'continue', listener: () => void): this
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'no_shell_integration', listener: () => void): this
  sendInput?: (input: string) => Promise<SendInputResult>
}

export interface NetworkDeviceCapabilities {
  brand: SwitchBrand
  discoveryCommand: string
  pagerDisableCommands: string[]
}

export interface NetworkDeviceHostSummary {
  assetType?: string
  host?: string
}
