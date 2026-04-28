import { BrownEventEmitter } from '../remote-terminal/event'
import { remoteSshConnect, remoteSshDisconnect, openWakeupShell, handleRemoteExecInput } from '../../../ssh/agentHandle'
import { getNetworkDeviceCapabilities, classifyNetworkDeviceCommand } from './command-policy'
import type {
  NetworkDeviceConnectionInfo,
  NetworkDeviceExecutionContext,
  NetworkDeviceProcessEvents,
  NetworkDeviceProcessPromise,
  NetworkDeviceTerminalInfo
} from './types'

interface DeviceShellStream {
  write: (input: string) => boolean
  on: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
  writable?: boolean
}

function stripAnsiSimple(text: string): string {
  return text
    .replace(/\x1B\[[0-9;]*[JKmsu]/g, '')
    .replace(/\x1B\[[?][0-9]*[hl]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\r/g, '')
}

function isPromptLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (/^[<\[].*[>\]]$/.test(trimmed)) return true
  if (trimmed.endsWith('>') || trimmed.endsWith('#') || trimmed.endsWith(']')) return true
  return false
}

function toChunkString(data: unknown): string {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object' && 'toString' in data && typeof data.toString === 'function') {
    return data.toString()
  }
  return String(data ?? '')
}

class NetworkDeviceProcess extends BrownEventEmitter<NetworkDeviceProcessEvents> {
  private sessionId = ''

  async run(sessionId: string, command: string, connectionInfo: NetworkDeviceConnectionInfo): Promise<void> {
    this.sessionId = sessionId
    const capabilities = getNetworkDeviceCapabilities(connectionInfo.asset_type)
    if (!capabilities) {
      const error = new Error('Unsupported network device asset type')
      this.emit('error', error)
      throw error
    }

    const streamResult = await openWakeupShell(sessionId)
    if (!streamResult.stream) {
      const error = new Error(streamResult.error || 'Failed to open network device shell')
      this.emit('error', error)
      throw error
    }

    const stream = streamResult.stream as DeviceShellStream
    const commands = [...capabilities.pagerDisableCommands, command]
    const filteredEchoes = new Set(commands.map((item) => item.trim()).filter(Boolean))

    await new Promise<void>((resolve, reject) => {
      let completed = false
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      let hardTimeout: ReturnType<typeof setTimeout> | null = null
      let lineBuffer = ''

      const cleanup = () => {
        if (idleTimer) clearTimeout(idleTimer)
        if (hardTimeout) clearTimeout(hardTimeout)
        stream.removeListener?.('data', onData)
        stream.removeListener?.('close', onClose)
        stream.removeListener?.('error', onError)
      }

      const finish = () => {
        if (completed) return
        completed = true
        cleanup()
        this.emit('completed')
        this.emit('continue')
        resolve()
      }

      const scheduleIdleCompletion = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => finish(), 1200)
      }

      const emitLine = (rawLine: string) => {
        const cleanLine = stripAnsiSimple(rawLine).trimEnd()
        const trimmed = cleanLine.trim()
        if (!trimmed) return
        if (filteredEchoes.has(trimmed)) return
        if (isPromptLine(trimmed)) {
          scheduleIdleCompletion()
          return
        }
        this.emit('line', cleanLine)
      }

      const flushBufferedLine = () => {
        const trimmed = lineBuffer.trim()
        if (!trimmed) return
        if (isPromptLine(trimmed)) {
          scheduleIdleCompletion()
          return
        }
        emitLine(lineBuffer)
        lineBuffer = ''
      }

      const onData = (data: unknown) => {
        const chunk = stripAnsiSimple(toChunkString(data))
        lineBuffer += chunk
        const parts = lineBuffer.split(/\n/)
        lineBuffer = parts.pop() || ''
        for (const line of parts) emitLine(line)
        flushBufferedLine()
      }

      const onClose = () => {
        if (!completed) finish()
      }

      const onError = (error: unknown) => {
        if (completed) return
        completed = true
        cleanup()
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        this.emit('error', normalizedError)
        reject(normalizedError)
      }

      hardTimeout = setTimeout(
        () => {
          onError(new Error('Network device command execution timed out'))
        },
        5 * 60 * 1000
      )

      stream.on('data', onData)
      stream.on('close', onClose)
      stream.on('error', onError)

      for (const item of commands) {
        stream.write(item + '\n')
      }
    })
  }

  async sendInput(input: string) {
    const result = handleRemoteExecInput(this.sessionId, input)
    return result.success ? { success: true as const } : { success: false as const, error: result.error, code: 'write-failed' as const }
  }
}

function mergeNetworkDevicePromise(process: NetworkDeviceProcess, promise: Promise<void>): NetworkDeviceProcessPromise {
  const merged = process as unknown as NetworkDeviceProcessPromise
  merged.then = promise.then.bind(promise)
  merged.catch = promise.catch.bind(promise)
  merged.finally = promise.finally.bind(promise)
  merged.sendInput = process.sendInput.bind(process)
  return merged
}

export class NetworkDeviceManager {
  private terminals = new Map<number, NetworkDeviceTerminalInfo>()
  private processes = new Map<number, NetworkDeviceProcess>()
  private nextTerminalId = 1
  private connectionInfo: NetworkDeviceConnectionInfo | null = null

  setConnectionInfo(info: NetworkDeviceConnectionInfo | null | undefined): void {
    this.connectionInfo = info || null
  }

  async createTerminal(): Promise<NetworkDeviceTerminalInfo> {
    if (!this.connectionInfo) {
      throw new Error('Connection information not set')
    }

    if (!this.connectionInfo.asset_type || !getNetworkDeviceCapabilities(this.connectionInfo.asset_type)) {
      throw new Error('Unsupported network device asset type')
    }

    const existingTerminal = Array.from(this.terminals.values()).find(
      (terminal) =>
        terminal.connectionInfo.host === this.connectionInfo?.host &&
        terminal.connectionInfo.port === this.connectionInfo?.port &&
        terminal.connectionInfo.username === this.connectionInfo?.username
    )
    if (existingTerminal) {
      return existingTerminal
    }

    const connectResult = await remoteSshConnect(this.connectionInfo as any)
    if (!connectResult?.id) {
      throw new Error(connectResult?.error || 'Network device connection failed')
    }

    const terminalInfo: NetworkDeviceTerminalInfo = {
      id: this.nextTerminalId++,
      sessionId: connectResult.id,
      busy: false,
      lastCommand: '',
      connectionInfo: this.connectionInfo,
      terminal: { show: () => {} }
    }

    this.terminals.set(terminalInfo.id, terminalInfo)
    return terminalInfo
  }

  getCommandPlan(terminalInfo: NetworkDeviceTerminalInfo, command: string) {
    const capabilities = getNetworkDeviceCapabilities(terminalInfo.connectionInfo.asset_type)
    if (!capabilities) {
      throw new Error('Unsupported network device asset type')
    }
    return classifyNetworkDeviceCommand(capabilities.brand, command)
  }

  runCommand(
    terminalInfo: NetworkDeviceTerminalInfo,
    command: string,
    _cwd?: string,
    _context?: NetworkDeviceExecutionContext
  ): NetworkDeviceProcessPromise {
    const process = new NetworkDeviceProcess()
    terminalInfo.busy = true
    terminalInfo.lastCommand = command
    this.processes.set(terminalInfo.id, process)

    process.once('completed', () => {
      terminalInfo.busy = false
    })
    process.once('error', () => {
      terminalInfo.busy = false
    })

    const promise = new Promise<void>((resolve, reject) => {
      process.once('continue', () => resolve())
      process.once('error', (error) => reject(error))
      process.run(terminalInfo.sessionId, command, terminalInfo.connectionInfo).catch(reject)
    })

    return mergeNetworkDevicePromise(process, promise)
  }

  async disconnectTerminal(terminalId: number): Promise<void> {
    const terminalInfo = this.terminals.get(terminalId)
    if (!terminalInfo) return
    this.processes.delete(terminalId)
    this.terminals.delete(terminalId)
    await remoteSshDisconnect(terminalInfo.sessionId)
  }

  async disposeAll(): Promise<void> {
    await Promise.all(Array.from(this.terminals.keys()).map((terminalId) => this.disconnectTerminal(terminalId)))
    this.terminals.clear()
    this.processes.clear()
  }
}
