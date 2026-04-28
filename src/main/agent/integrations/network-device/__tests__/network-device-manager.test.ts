import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { remoteSshConnectMock, remoteSshDisconnectMock, openWakeupShellMock, handleRemoteExecInputMock } = vi.hoisted(() => ({
  remoteSshConnectMock: vi.fn(async () => ({ id: 'ssh_1' })),
  remoteSshDisconnectMock: vi.fn(async () => ({ success: true })),
  openWakeupShellMock: vi.fn(),
  handleRemoteExecInputMock: vi.fn(() => ({ success: true }))
}))

vi.mock('../../../ssh/agentHandle', () => ({
  remoteSshConnect: remoteSshConnectMock,
  remoteSshDisconnect: remoteSshDisconnectMock,
  openWakeupShell: openWakeupShellMock,
  handleRemoteExecInput: handleRemoteExecInputMock
}))

import { NetworkDeviceManager } from '../index'

describe('NetworkDeviceManager', () => {
  let manager: NetworkDeviceManager

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    manager = new NetworkDeviceManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('classifies read-only switch commands without approval', async () => {
    manager.setConnectionInfo({
      host: '10.0.0.1',
      port: 22,
      username: 'admin',
      password: 'x',
      needProxy: false,
      asset_type: 'person-switch-cisco'
    })

    const terminal = await manager.createTerminal()
    const plan = manager.getCommandPlan(terminal, 'show version')

    expect(plan.requiresApproval).toBe(false)
    expect(plan.safety).toBe('read-only')
  })

  it('classifies configuration commands with approval', async () => {
    manager.setConnectionInfo({
      host: '10.0.0.2',
      port: 22,
      username: 'admin',
      password: 'x',
      needProxy: false,
      asset_type: 'person-switch-huawei'
    })

    const terminal = await manager.createTerminal()
    const plan = manager.getCommandPlan(terminal, 'system-view')

    expect(plan.requiresApproval).toBe(true)
    expect(plan.safety).toBe('configuration')
  })

  it('writes pager disable commands before the device command', async () => {
    const write = vi.fn(() => true)
    const listeners = new Map<string, (...args: unknown[]) => void>()

    openWakeupShellMock.mockResolvedValue({
      stream: {
        write,
        writable: true,
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          listeners.set(event, listener)
        }),
        removeListener: vi.fn((event: string) => {
          listeners.delete(event)
        })
      }
    })

    manager.setConnectionInfo({
      host: '10.0.0.1',
      port: 22,
      username: 'admin',
      password: 'x',
      needProxy: false,
      asset_type: 'person-switch-cisco'
    })

    const terminal = await manager.createTerminal()
    const process = manager.runCommand(terminal, 'show version')

    expect(write).toHaveBeenNthCalledWith(1, 'terminal length 0\n')
    expect(write).toHaveBeenNthCalledWith(2, 'show version\n')

    listeners.get('data')?.('Cisco IOS XE Software\n')
    listeners.get('data')?.('switch#')

    await expect(process).resolves.toBeUndefined()
  })
})
