import { describe, expect, it } from 'vitest'
import {
  getSwitchBrandFromAssetType,
  getSwitchDiscoveryCommand,
  getSwitchPagerDisableCommands,
  getSwitchSafetyClassification
} from '../switch-prompts'

describe('switch prompts helpers', () => {
  it('maps asset type to brand', () => {
    expect(getSwitchBrandFromAssetType('person-switch-cisco')).toBe('cisco')
    expect(getSwitchBrandFromAssetType('person-switch-huawei')).toBe('huawei')
    expect(getSwitchBrandFromAssetType('person')).toBeNull()
  })

  it('returns discovery and pager commands', () => {
    expect(getSwitchDiscoveryCommand('cisco')).toBe('show version')
    expect(getSwitchDiscoveryCommand('huawei')).toBe('display version')
    expect(getSwitchPagerDisableCommands('cisco')).toEqual(['terminal length 0'])
    expect(getSwitchPagerDisableCommands('huawei')).toEqual(['screen-length 0 temporary'])
  })

  it('classifies command safety', () => {
    expect(getSwitchSafetyClassification('cisco', 'show version')).toBe('read-only')
    expect(getSwitchSafetyClassification('cisco', 'configure terminal')).toBe('configuration')
    expect(getSwitchSafetyClassification('huawei', 'system-view')).toBe('configuration')
    expect(getSwitchSafetyClassification('huawei', 'reboot')).toBe('destructive')
  })
})
