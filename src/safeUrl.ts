const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export function normalizeExternalUrl(value: string): string | undefined {
  const trimmed = value.trim()
  const hasControlCharacter = [...trimmed].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })

  if (!trimmed || trimmed.length > 2_048 || hasControlCharacter) {
    return undefined
  }

  try {
    const parsed = new URL(trimmed)

    if (!ALLOWED_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) {
      return undefined
    }

    return parsed.toString()
  } catch {
    return undefined
  }
}

export function parseGitHubIssueOrPullUrl(value: string) {
  const trimmed = value.trim()
  const candidate = /^github\.com\//i.test(trimmed) ? `https://${trimmed}` : trimmed
  const normalized = normalizeExternalUrl(candidate)

  if (!normalized) {
    return undefined
  }

  const parsed = new URL(normalized)

  if (parsed.hostname.toLowerCase() !== 'github.com') {
    return undefined
  }

  const match = parsed.pathname.match(
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:pull|pulls|issues)\/(\d+)\/?$/,
  )

  if (!match) {
    return undefined
  }

  return {
    normalized,
    repo: `${match[1]}/${match[2]}`,
    number: match[3],
  }
}
