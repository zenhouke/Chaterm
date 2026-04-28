import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getGlobalStateMock,
  remoteTerminalManagerCreateTerminalMock,
  remoteTerminalManagerSetConnectionInfoMock,
  remoteTerminalManagerRunCommandMock,
  remoteTerminalManagerDisposeAllMock,
  networkDeviceManagerCreateTerminalMock,
  networkDeviceManagerSetConnectionInfoMock,
  networkDeviceManagerRunCommandMock,
  networkDeviceManagerDisposeAllMock
} = vi.hoisted(() => ({
  getGlobalStateMock: vi.fn(async () => ({})),
  remoteTerminalManagerCreateTerminalMock: vi.fn(),
  remoteTerminalManagerSetConnectionInfoMock: vi.fn(),
  remoteTerminalManagerRunCommandMock: vi.fn(),
  remoteTerminalManagerDisposeAllMock: vi.fn(),
  networkDeviceManagerCreateTerminalMock: vi.fn(),
  networkDeviceManagerSetConnectionInfoMock: vi.fn(),
  networkDeviceManagerRunCommandMock: vi.fn(),
  networkDeviceManagerDisposeAllMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getAppPath: () => '' },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn(), removeAllListeners: vi.fn() },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) }
}))

vi.mock('@storage/db/chaterm.service', () => ({
  ChatermDatabaseService: { getInstance: vi.fn(async () => ({})) }
}))
const { connectAssetInfoMock } = vi.hoisted(() => ({
  connectAssetInfoMock: vi.fn(async () => undefined)
}))

vi.mock('@storage/database', () => ({ connectAssetInfo: connectAssetInfoMock }))
vi.mock('../../../../ssh/agentHandle', () => ({
  remoteSshConnect: vi.fn(),
  remoteSshDisconnect: vi.fn(),
  isWakeupSession: vi.fn().mockReturnValue(false),
  openWakeupShell: vi.fn(),
  findWakeupConnectionInfoByHost: vi.fn().mockReturnValue(null)
}))
vi.mock('@integrations/remote-terminal', () => ({
  RemoteTerminalManager: class {
    createTerminal = remoteTerminalManagerCreateTerminalMock
    setConnectionInfo = remoteTerminalManagerSetConnectionInfoMock
    runCommand = remoteTerminalManagerRunCommandMock
    disposeAll = remoteTerminalManagerDisposeAllMock
  }
}))

vi.mock('@integrations/network-device', () => ({
  NetworkDeviceManager: class {
    createTerminal = networkDeviceManagerCreateTerminalMock
    setConnectionInfo = networkDeviceManagerSetConnectionInfoMock
    runCommand = networkDeviceManagerRunCommandMock
    disposeAll = networkDeviceManagerDisposeAllMock
    getCommandPlan = vi.fn(() => ({
      normalizedCommand: 'show version',
      safety: 'read-only',
      requiresApproval: false,
      interactive: false
    }))
  }
}))
vi.mock('@integrations/local-terminal', () => ({
  LocalTerminalManager: class {},
  LocalCommandProcess: class {}
}))
vi.mock('@services/telemetry/TelemetryService', () => ({ telemetryService: { captureTaskFeedback: vi.fn() } }))
vi.mock('@api/index', () => ({
  ApiHandler: class {},
  buildApiHandler: vi.fn(() => ({}))
}))
vi.mock('@core/storage/state', () => ({
  getGlobalState: getGlobalStateMock,
  getUserConfig: vi.fn(async () => ({}))
}))
vi.mock('@core/prompts/responses', () => ({
  getFormatResponse: () => ({
    toolError: (msg: string) => `ERR:${msg}`,
    toolAlreadyUsed: (name: string) => `USED:${name}`
  })
}))

import { Task } from '../index'

describe('Task dispatch and state flow', () => {
  let task: any

  beforeEach(() => {
    vi.clearAllMocks()
    getGlobalStateMock.mockResolvedValue({})

    task = Object.create((Task as unknown as { prototype: object }).prototype) as any
    task.taskId = 'task-test'
    task.userMessageContent = []
    task.chatermMessages = []
    task.pendingToolResults = []
    task.userMessageContentReady = true
    task.connectedHosts = new Set()
    task.messages = {
      commandExecutedOutput: 'Command executed successfully.',
      commandStillRunning: 'Command is still running.',
      commandHereIsOutput: '\nOutput so far:\n',
      commandUpdateFuture: '\nMore output may arrive later.',
      sshConnectionStarting: 'Connecting to {host}',
      sshConnectionSuccess: 'Connected to {host}',
      sshConnectionFailed: 'Failed to connect to {host}'
    }
    task.autoApprovalSettings = { enabled: false, actions: {} }
    task.remoteTerminalManager = {
      createTerminal: remoteTerminalManagerCreateTerminalMock,
      setConnectionInfo: remoteTerminalManagerSetConnectionInfoMock,
      runCommand: remoteTerminalManagerRunCommandMock,
      disposeAll: remoteTerminalManagerDisposeAllMock
    }
    task.networkDeviceManager = {
      createTerminal: networkDeviceManagerCreateTerminalMock,
      setConnectionInfo: networkDeviceManagerSetConnectionInfoMock,
      runCommand: networkDeviceManagerRunCommandMock,
      disposeAll: networkDeviceManagerDisposeAllMock,
      getCommandPlan: vi.fn(() => ({
        normalizedCommand: 'show version',
        safety: 'read-only',
        requiresApproval: false,
        interactive: false
      }))
    }

    task.say = vi.fn().mockResolvedValue(undefined)
    task.ask = vi.fn().mockResolvedValue(undefined)
    task.abortTask = vi.fn().mockResolvedValue(undefined)
    task.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
    task.saveCheckpoint = vi.fn().mockResolvedValue(undefined)
    task.getToolDescription = vi.fn(() => '[mock-tool]')
    task.addTodoStatusUpdateReminder = vi.fn().mockResolvedValue(undefined)
    task.setNextUserInputContentParts = vi.fn()
    task.truncateHistoryAtTimestamp = vi.fn().mockResolvedValue(undefined)
    task.addToApiConversationHistory = vi.fn().mockResolvedValue(undefined)
    task.recursivelyMakeChatermRequests = vi.fn().mockResolvedValue(true)
    task.handleEmptyAssistantResponse = vi.fn().mockResolvedValue(false)
    task.getUserLocale = vi.fn().mockResolvedValue('en-US')
    task.createInteractionLlmCaller = vi.fn(() => vi.fn())
    task.buildHostInfo = vi.fn((hostId: string) => ({ hostId, hostName: hostId, colorTag: 'blue' }))

    task.handleExecuteCommandToolUse = vi.fn().mockResolvedValue(undefined)
    task.handleAskFollowupQuestionToolUse = vi.fn().mockResolvedValue(undefined)
    task.handleTodoWriteToolUse = vi.fn().mockResolvedValue(undefined)
    task.handleTodoReadToolUse = vi.fn().mockResolvedValue(undefined)
    task.handleGrepSearchToolUse = vi.fn().mockResolvedValue(undefined)
    task.responseFormatter = {
      toolError: (msg: string) => `ERR:${msg}`,
      toolAlreadyUsed: (name: string) => `USED:${name}`,
      toolDenied: () => 'Denied.',
      toolResult: (msg: string) => msg,
      noToolsUsed: () => 'No tools used.',
      tooManyMistakes: (msg: string) => `Too many mistakes: ${msg}`
    }
  })

  it('handleWebviewAskResponse should persist payload and apply truncation', async () => {
    const contentParts = [{ type: 'chip', chipType: 'doc' }]
    const toolResult = { output: 'ls output', toolName: 'execute_command' }
    await task.handleWebviewAskResponse('yesButtonClicked', 'ok', 12345, contentParts, toolResult)

    expect(task.truncateHistoryAtTimestamp).toHaveBeenCalledWith(12345)
    expect(task.setNextUserInputContentParts).toHaveBeenCalledWith(contentParts)
    expect(task.askResponsePayload).toEqual({
      response: 'yesButtonClicked',
      text: 'ok',
      contentParts,
      toolResult
    })
  })

  it('handleToolUse should block tool execution in chat mode', async () => {
    getGlobalStateMock.mockResolvedValue({ mode: 'chat' })

    await task.handleToolUse({
      name: 'execute_command',
      params: { command: 'ls' },
      partial: false
    })

    expect(task.say).toHaveBeenCalledWith(
      'error',
      'Chat mode does not support tool execution. This mode is for conversation, learning, and brainstorming only.',
      false
    )
    expect(task.saveCheckpoint).toHaveBeenCalledTimes(1)
    expect(task.handleExecuteCommandToolUse).not.toHaveBeenCalled()
    expect(task.userMessageContent[0].text).toContain('ERR:Chat mode does not support tool execution')
  })

  it('handleToolUse should skip after previous rejection and keep reason text', async () => {
    task.didRejectTool = true
    await task.handleToolUse({ name: 'grep_search', params: { query: 'abc' }, partial: true })

    expect(task.handleGrepSearchToolUse).not.toHaveBeenCalled()
    expect(task.userMessageContent[0].text).toContain('interrupted and not executed')
  })

  it('handleToolUse should reject second non-todo tool in same turn', async () => {
    task.didAlreadyUseTool = true
    await task.handleToolUse({ name: 'grep_search', params: { query: 'abc' }, partial: false })

    expect(task.handleGrepSearchToolUse).not.toHaveBeenCalled()
    expect(task.userMessageContent[0].text).toBe('USED:grep_search')
  })

  it('handleToolUse should still allow todo tool after another tool', async () => {
    task.didAlreadyUseTool = true
    await task.handleToolUse({ name: 'todo_write', params: {}, partial: false })

    expect(task.handleTodoWriteToolUse).toHaveBeenCalledTimes(1)
  })

  it('handleToolUse should ignore unsupported partial tool call', async () => {
    await task.handleToolUse({ name: 'grep_search', params: { query: 'a' }, partial: true })
    expect(task.handleGrepSearchToolUse).not.toHaveBeenCalled()
  })

  it('handleToolUse should dispatch execute_command and append todo reminder', async () => {
    await task.handleToolUse({ name: 'execute_command', params: { command: 'pwd' }, partial: false })

    expect(task.handleExecuteCommandToolUse).toHaveBeenCalledTimes(1)
    expect(task.addTodoStatusUpdateReminder).toHaveBeenCalledWith('')
  })

  it('handleToolUse should not append todo reminder for ask_followup_question', async () => {
    await task.handleToolUse({
      name: 'ask_followup_question',
      params: { question: 'next?', options: '["a"]' },
      partial: false
    })

    expect(task.handleAskFollowupQuestionToolUse).toHaveBeenCalledTimes(1)
    expect(task.addTodoStatusUpdateReminder).not.toHaveBeenCalled()
  })

  it('processAssistantResponse should use empty response handler', async () => {
    const result = await task.processAssistantResponse('')
    expect(task.handleEmptyAssistantResponse).toHaveBeenCalledTimes(1)
    expect(result).toBe(false)
  })

  it('processAssistantResponse should save message and recurse for non-empty response', async () => {
    const result = await task.processAssistantResponse('assistant text')

    expect(task.addToApiConversationHistory).toHaveBeenCalledWith({
      role: 'assistant',
      content: [{ type: 'text', text: 'assistant text' }]
    })
    expect(task.recursivelyMakeChatermRequests).toHaveBeenCalledWith(task.userMessageContent)
    expect(result).toBe(true)
  })

  it('executeCommandTool should route switch hosts to NetworkDeviceManager', async () => {
    vi.useFakeTimers()

    connectAssetInfoMock.mockResolvedValue({
      host: '10.0.0.10',
      port: 22,
      username: 'admin',
      password: 'secret',
      needProxy: false
    })

    const process = Object.assign(Promise.resolve(), {
      on: vi.fn((_event: string, listener: (line: string) => void) => {
        if (_event === 'line') {
          listener('Cisco IOS XE Software')
        }
        return process
      }),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === 'completed') {
          listener()
        }
        return process
      })
    })

    const terminal = {
      id: 1,
      sessionId: 'switch-1',
      busy: false,
      lastCommand: '',
      connectionInfo: { host: '10.0.0.10', asset_type: 'person-switch-cisco', needProxy: false },
      terminal: { show: vi.fn() }
    }

    networkDeviceManagerCreateTerminalMock.mockResolvedValue(terminal)
    networkDeviceManagerRunCommandMock.mockReturnValue(process)
    task.hosts = [{ host: '10.0.0.10', uuid: 'asset-1', assetType: 'person-switch-cisco' }]

    const resultPromise = task.executeCommandTool('show version', '10.0.0.10')
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(networkDeviceManagerSetConnectionInfoMock).toHaveBeenCalledWith({
      host: '10.0.0.10',
      port: 22,
      username: 'admin',
      password: 'secret',
      needProxy: false,
      asset_type: 'person-switch-cisco'
    })
    expect(networkDeviceManagerRunCommandMock).toHaveBeenCalledTimes(1)
    expect(remoteTerminalManagerRunCommandMock).not.toHaveBeenCalled()
    expect(result).toContain('Command executed successfully.')

    vi.useRealTimers()
  })

  it('executeCommandTool should route normal SSH hosts to RemoteTerminalManager', async () => {
    vi.useFakeTimers()

    connectAssetInfoMock.mockResolvedValue({
      host: '10.0.0.20',
      port: 22,
      username: 'root',
      password: 'secret',
      needProxy: false
    })

    const process = Object.assign(Promise.resolve(), {
      on: vi.fn((_event: string, listener: (line: string) => void) => {
        if (_event === 'line') {
          listener('/root')
        }
        return process
      }),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === 'completed') {
          listener()
        }
        return process
      })
    })

    const terminal = {
      id: 2,
      busy: false,
      cwd: '/root',
      sessionId: 'ssh-1',
      terminal: { show: vi.fn() }
    }

    remoteTerminalManagerCreateTerminalMock.mockResolvedValue(terminal)
    remoteTerminalManagerRunCommandMock.mockReturnValue(process)
    task.hosts = [{ host: '10.0.0.20', uuid: 'asset-2', assetType: 'person' }]

    const resultPromise = task.executeCommandTool('pwd', '10.0.0.20')
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(remoteTerminalManagerSetConnectionInfoMock).toHaveBeenCalledWith({
      host: '10.0.0.20',
      port: 22,
      username: 'root',
      password: 'secret',
      needProxy: false
    })
    expect(remoteTerminalManagerRunCommandMock).toHaveBeenCalledTimes(1)
    expect(networkDeviceManagerRunCommandMock).not.toHaveBeenCalled()
    expect(result).toContain('Command executed successfully.')

    vi.useRealTimers()
  })
})
