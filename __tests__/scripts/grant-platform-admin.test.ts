import { describe, expect, it } from 'vitest'
import { parseAdminGrantArgs } from '@/scripts/grant-platform-admin'

/**
 * Argument parsing for the platform-administrator bootstrap.
 *
 * Worth testing on its own because every mistake this parser can make is
 * expensive: `profiles.is_admin` is the key to `requireAdmin`, the whole
 * `/admin` subtree and the approver-grant route, and nothing else in the
 * product ever writes it. A flag silently ignored here is a privilege granted
 * to the wrong person, or a dry run that was not one.
 */

const PROFILE = '11111111-1111-4111-8111-111111111111'

describe('parseAdminGrantArgs', () => {
  it('plans a grant that has not been confirmed as a dry run', () => {
    expect(parseAdminGrantArgs(['--grant', PROFILE, '--reason', 'AC-14 approver bootstrap'])).toEqual({
      action: 'grant',
      profileId: PROFILE,
      reason: 'AC-14 approver bootstrap',
      apply: false,
    })
  })

  it('writes only when --yes is given', () => {
    expect(parseAdminGrantArgs(['--grant', PROFILE, '--reason', 'why', '--yes']))
      .toMatchObject({ action: 'grant', apply: true })
  })

  it('plans a revoke the same way', () => {
    expect(parseAdminGrantArgs(['--revoke', PROFILE, '--reason', 'left the team', '--yes'])).toEqual({
      action: 'revoke',
      profileId: PROFILE,
      reason: 'left the team',
      apply: true,
    })
  })

  it('lists current administrators without needing a reason', () => {
    expect(parseAdminGrantArgs(['--list'])).toEqual({ action: 'list' })
  })

  it('lowercases the profile id so two spellings cannot read as two people', () => {
    expect(parseAdminGrantArgs(['--grant', PROFILE.toUpperCase(), '--reason', 'why']))
      .toMatchObject({ profileId: PROFILE })
  })

  it('normalises a reason to NFC and trims it, as migration 048 requires', () => {
    expect(parseAdminGrantArgs(['--grant', PROFILE, '--reason', '  jose  ']))
      .toMatchObject({ reason: 'jose' })
  })

  it.each([
    ['no action at all', []],
    ['two actions at once', ['--grant', PROFILE, '--revoke', PROFILE, '--reason', 'why']],
    ['a grant with no reason', ['--grant', PROFILE]],
    ['a grant with an empty reason', ['--grant', PROFILE, '--reason', '   ']],
    ['a profile id that is not a uuid', ['--grant', 'someone', '--reason', 'why']],
    ['a missing profile id', ['--grant', '--reason', 'why']],
    ['an unknown flag', ['--grant', PROFILE, '--reason', 'why', '--force']],
    ['--list combined with a write', ['--list', '--grant', PROFILE, '--reason', 'why']],
  ])('refuses %s', (_label, argv) => {
    expect(() => parseAdminGrantArgs(argv)).toThrow()
  })

  it('refuses a reason longer than the column allows', () => {
    expect(() => parseAdminGrantArgs(['--grant', PROFILE, '--reason', 'x'.repeat(2001)])).toThrow()
  })
})
