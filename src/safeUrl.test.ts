import { describe, expect, it } from 'vitest'
import { normalizeExternalUrl, parseGitHubIssueOrPullUrl } from './safeUrl'

describe('safeUrl', () => {
  it('normalizes credential-free HTTP(S) links', () => {
    expect(normalizeExternalUrl('https://example.com/path?q=1')).toBe(
      'https://example.com/path?q=1',
    )
    expect(normalizeExternalUrl('http://localhost:4173/report')).toBe(
      'http://localhost:4173/report',
    )
  })

  it('rejects script schemes, embedded credentials, and control characters', () => {
    expect(normalizeExternalUrl('javascript:alert(1)')).toBeUndefined()
    expect(normalizeExternalUrl('https://user:secret@example.com/path')).toBeUndefined()
    expect(normalizeExternalUrl('https://example.com/\nmalicious')).toBeUndefined()
  })

  it('accepts only GitHub issue and pull-request paths', () => {
    expect(parseGitHubIssueOrPullUrl('github.com/owner/repo/issues/12')).toMatchObject({
      repo: 'owner/repo',
      number: '12',
    })
    expect(parseGitHubIssueOrPullUrl('https://gist.github.com/owner/abc')).toBeUndefined()
    expect(parseGitHubIssueOrPullUrl('https://github.com/owner/repo/actions/runs/1')).toBeUndefined()
  })
})
