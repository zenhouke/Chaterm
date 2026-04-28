import {
  getSwitchDiscoveryCommand,
  getSwitchPagerDisableCommands,
  getSwitchSafetyClassification,
  getSwitchBrandFromAssetType,
  type SwitchBrand
} from '@core/prompts/switch-prompts'
import type { CommandSafety, NetworkDeviceCapabilities } from './types'

export interface NetworkDeviceCommandPolicyResult {
  normalizedCommand: string
  safety: CommandSafety
  requiresApproval: boolean
  interactive: boolean
}

export function getNetworkDeviceCapabilities(assetType: string | undefined): NetworkDeviceCapabilities | null {
  const brand = getSwitchBrandFromAssetType(assetType)
  if (!brand) return null

  return {
    brand,
    discoveryCommand: getSwitchDiscoveryCommand(brand),
    pagerDisableCommands: getSwitchPagerDisableCommands(brand)
  }
}

export function classifyNetworkDeviceCommand(brand: SwitchBrand, command: string): NetworkDeviceCommandPolicyResult {
  const normalizedCommand = command.trim()
  const safety = getSwitchSafetyClassification(brand, normalizedCommand)

  return {
    normalizedCommand,
    safety,
    requiresApproval: safety !== 'read-only',
    interactive: safety === 'interactive'
  }
}
