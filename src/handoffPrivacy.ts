export const MAX_HANDOFF_PRIVACY_CHARACTERS = 2_000_000
export const MAX_HANDOFF_PRIVACY_FINDINGS = 500
export const MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS = 16_384
const MAX_HANDOFF_PRIVACY_CANDIDATES =
  MAX_HANDOFF_PRIVACY_FINDINGS * 8
const MAX_CREDENTIAL_NAME_CHARACTERS = 128
const MAX_CREDENTIAL_URL_COMPONENT_CHARACTERS = 512
const MAX_JWT_HEADER_CHARACTERS = 1_024
const MAX_JWT_PAYLOAD_CHARACTERS = 16_384
const MAX_JWT_SIGNATURE_CHARACTERS = 4_096

export type HandoffPrivacyCategory =
  | 'private-key'
  | 'github-token'
  | 'aws-access-key-id'
  | 'bearer-token'
  | 'jwt'
  | 'credential-url'
  | 'credential-assignment'

export const handoffPrivacyCategoryLabels: Record<
  HandoffPrivacyCategory,
  string
> = {
  'private-key': 'Private key',
  'github-token': 'GitHub token',
  'aws-access-key-id': 'AWS access key ID',
  'bearer-token': 'Bearer token',
  jwt: 'JSON Web Token',
  'credential-url': 'URL with embedded credentials',
  'credential-assignment': 'Credential assignment',
}

export type HandoffPrivacyFinding = {
  category: HandoffPrivacyCategory
  line: number
}

export type HandoffPrivacyPreflightResult =
  | {
      status: 'checked'
      redactedMarkdown: string
      findings: HandoffPrivacyFinding[]
      checkedCharacters: number
    }
  | {
      status: 'blocked'
      reason:
        | 'input-too-large'
        | 'finding-limit-exceeded'
        | 'credential-value-limit-exceeded'
        | 'credential-value-ambiguous'
      redactedMarkdown: ''
      findings: []
      checkedCharacters: number
      limit: number
    }

type RedactionCandidate = {
  category: HandoffPrivacyCategory
  start: number
  end: number
  findingStart?: number
  priority: number
  replacement: string
}

type CandidateCollector = {
  candidates: RedactionCandidate[]
  overflowed: boolean
  blockedReason:
    | 'credential-value-limit-exceeded'
    | 'credential-value-ambiguous'
    | null
}

function redactionLabel(category: HandoffPrivacyCategory) {
  return `[REDACTED: ${category}]`
}

function preserveLineBreaks(value: string) {
  return value.replace(/[^\r\n]+/g, '')
}

function addCandidate(
  collector: CandidateCollector,
  candidate: RedactionCandidate,
) {
  if (
    collector.overflowed ||
    collector.blockedReason ||
    candidate.start < 0 ||
    candidate.end <= candidate.start
  ) {
    return false
  }

  if (collector.candidates.length >= MAX_HANDOFF_PRIVACY_CANDIDATES) {
    collector.overflowed = true
    return false
  }

  collector.candidates.push(candidate)
  return true
}

function collectWholeMatches(
  markdown: string,
  collector: CandidateCollector,
  pattern: RegExp,
  category: HandoffPrivacyCategory,
  priority: number,
  replacementForMatch: (matchedValue: string) => string = () =>
    redactionLabel(category),
) {
  for (const match of markdown.matchAll(pattern)) {
    if (match.index === undefined) {
      continue
    }

    if (
      !addCandidate(collector, {
        category,
        start: match.index,
        end: match.index + match[0].length,
        priority,
        replacement: replacementForMatch(match[0]),
      })
    ) {
      break
    }
  }
}

function isPlaceholderCredential(value: string) {
  const normalized = value.trim().toLowerCase()

  return (
    normalized.length < 8 ||
    /^(?:\*+|x+|redacted|masked|none|null|undefined|changeme|change-me|change_me|placeholder|(?:required|example|sample|dummy|fake|test|testing|todo)(?:[-_ ].*)?|your[-_ ].*|<[^>]+>|\$\{[^}]+\}|\{\{[^}]+\}\})$/i.test(
      normalized,
    ) ||
    /^(?:process\.env|import\.meta\.env|env\.|os\.environ|\$[a-z_])/i.test(
      normalized,
    )
  )
}

function hasHighConfidenceUnquotedShape(value: string) {
  return (
    value.length >= 12 &&
    /[a-z]/i.test(value) &&
    (/\d/.test(value) || /[-_.~+/=]/.test(value))
  )
}

function isCredentialName(value: string) {
  return /(?:^|[-_ ])(?:api[-_ ]?key|access[-_ ]?token|auth[-_ ]?token|client[-_ ]?secret|secret(?:[-_ ]?access[-_ ]?key)?|password|passwd|token)$/i.test(
    value,
  )
}

function isUnquotedCredentialDelimiter(character: string | undefined) {
  return (
    character === undefined ||
    character === ' ' ||
    character === '\t' ||
    character === '\r' ||
    character === '\n' ||
    character === ',' ||
    character === ';' ||
    character === '#'
  )
}

function isQuotedCredentialTerminator(character: string | undefined) {
  return (
    isUnquotedCredentialDelimiter(character) ||
    character === '}' ||
    character === ']' ||
    character === ')'
  )
}

function collectCapturedCredential(
  markdown: string,
  collector: CandidateCollector,
  pattern: RegExp,
  category: HandoffPrivacyCategory,
  priority: number,
  captureIndex: number,
) {
  for (const match of markdown.matchAll(pattern)) {
    const value = match[captureIndex]

    if (match.index === undefined || !value || isPlaceholderCredential(value)) {
      continue
    }

    const offset = match[0].lastIndexOf(value)

    if (
      !addCandidate(collector, {
        category,
        start: match.index + offset,
        end: match.index + offset + value.length,
        priority,
        replacement: redactionLabel(category),
      })
    ) {
      break
    }
  }
}

function collectCredentialAssignments(
  markdown: string,
  collector: CandidateCollector,
) {
  const pattern = new RegExp(
    `\\b([A-Za-z][A-Za-z0-9 _-]{0,${
      MAX_CREDENTIAL_NAME_CHARACTERS - 1
    }})\\b[ \\t]*[:=][ \\t]*`,
    'gi',
  )
  let match: RegExpExecArray | null

  while ((match = pattern.exec(markdown)) !== null) {
    const credentialName = match[1].trimEnd()

    if (!isCredentialName(credentialName)) {
      continue
    }

    const openingQuote = markdown[pattern.lastIndex]
    const quoted = openingQuote === '"' || openingQuote === "'"
    const valueStart = pattern.lastIndex + (quoted ? 1 : 0)
    let valueEnd = valueStart

    if (quoted) {
      let consecutiveBackslashes = 0

      while (valueEnd < markdown.length) {
        const character = markdown[valueEnd]

        if (
          character === openingQuote &&
          consecutiveBackslashes % 2 === 0
        ) {
          break
        }

        if (
          character === '\r' ||
          character === '\n'
        ) {
          collector.blockedReason = 'credential-value-ambiguous'
          return
        }

        if (
          valueEnd - valueStart >=
          MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS
        ) {
          collector.blockedReason = 'credential-value-limit-exceeded'
          return
        }

        consecutiveBackslashes =
          character === '\\' ? consecutiveBackslashes + 1 : 0
        valueEnd += 1
      }

      if (
        markdown[valueEnd] !== openingQuote ||
        !isQuotedCredentialTerminator(markdown[valueEnd + 1])
      ) {
        collector.blockedReason = 'credential-value-ambiguous'
        return
      }

      pattern.lastIndex = valueEnd + 1
    } else {
      while (
        !isUnquotedCredentialDelimiter(markdown[valueEnd])
      ) {
        const character = markdown[valueEnd]

        if (
          character === '"' ||
          character === "'"
        ) {
          collector.blockedReason = 'credential-value-ambiguous'
          return
        }

        if (
          valueEnd - valueStart >=
          MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS
        ) {
          collector.blockedReason = 'credential-value-limit-exceeded'
          return
        }

        valueEnd += 1
      }

      pattern.lastIndex = valueEnd
    }

    const value = markdown.slice(valueStart, valueEnd)
    const isExplicitPassword =
      /(?:password|passwd)$/i.test(credentialName)

    if (
      value.length < 8 ||
      isPlaceholderCredential(value) ||
      (!quoted &&
        !hasHighConfidenceUnquotedShape(value) &&
        !(isExplicitPassword && value.length >= 12))
    ) {
      continue
    }

    if (
      !addCandidate(collector, {
        category: 'credential-assignment',
        start: valueStart,
        end: valueEnd,
        priority: 90,
        replacement: redactionLabel('credential-assignment'),
      })
    ) {
      break
    }
  }
}

function collectCredentialUrls(
  markdown: string,
  collector: CandidateCollector,
) {
  const pattern = new RegExp(
    `\\b(https?|postgres(?:ql)?|mysql|mariadb|rediss?|mongodb(?:\\+srv)?):\\/\\/` +
      `([^\\s/?#:@]{1,${MAX_CREDENTIAL_URL_COMPONENT_CHARACTERS}}):` +
      `([^\\s/?#@]{1,${MAX_CREDENTIAL_URL_COMPONENT_CHARACTERS}})@`,
    'gi',
  )

  for (const match of markdown.matchAll(pattern)) {
    if (match.index === undefined) {
      continue
    }

    if (
      !addCandidate(collector, {
        category: 'credential-url',
        start: match.index,
        end: match.index + match[0].length,
        priority: 85,
        replacement: `${match[1]}://${redactionLabel('credential-url')}@`,
      })
    ) {
      break
    }
  }
}

function collectPrivateKeys(
  markdown: string,
  collector: CandidateCollector,
) {
  const beginPattern =
    /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----/g
  let searchIndex = 0

  while (searchIndex < markdown.length) {
    beginPattern.lastIndex = searchIndex
    const match = beginPattern.exec(markdown)

    if (!match || match.index === undefined) {
      break
    }

    const endMarker = `-----END ${match[1]}-----`
    const endMarkerIndex = markdown.indexOf(
      endMarker,
      match.index + match[0].length,
    )
    const end =
      endMarkerIndex === -1
        ? markdown.length
        : endMarkerIndex + endMarker.length
    const matchedValue = markdown.slice(match.index, end)

    if (
      !addCandidate(collector, {
        category: 'private-key',
        start: match.index,
        end,
        priority: 100,
        replacement: `${redactionLabel('private-key')}${preserveLineBreaks(
          matchedValue,
        )}`,
      })
    ) {
      break
    }

    if (endMarkerIndex === -1) {
      break
    }

    searchIndex = end
  }
}

function collectCandidates(markdown: string) {
  const collector: CandidateCollector = {
    candidates: [],
    overflowed: false,
    blockedReason: null,
  }

  collectPrivateKeys(markdown, collector)
  collectCredentialAssignments(markdown, collector)
  collectCredentialUrls(markdown, collector)
  collectCapturedCredential(
    markdown,
    collector,
    /\bBearer[ \t]+([A-Za-z0-9._~+/=-]{20,})/gi,
    'bearer-token',
    80,
    1,
  )
  collectWholeMatches(
    markdown,
    collector,
    /\b(?:github_pat_[A-Za-z0-9_]{20,255}|gh[pousr]_[A-Za-z0-9]{20,255})\b/g,
    'github-token',
    75,
  )
  collectWholeMatches(
    markdown,
    collector,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    'aws-access-key-id',
    75,
  )
  collectWholeMatches(
    markdown,
    collector,
    new RegExp(
      `\\beyJ[A-Za-z0-9_-]{7,${MAX_JWT_HEADER_CHARACTERS}}\\.` +
        `[A-Za-z0-9_-]{10,${MAX_JWT_PAYLOAD_CHARACTERS}}\\.` +
        `[A-Za-z0-9_-]{16,${MAX_JWT_SIGNATURE_CHARACTERS}}\\b`,
      'g',
    ),
    'jwt',
    70,
  )

  return collector
}

function resolveOverlaps(
  markdown: string,
  candidates: RedactionCandidate[],
) {
  const sorted = [...candidates].sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      right.priority - left.priority ||
      left.category.localeCompare(right.category),
  )
  const resolved: RedactionCandidate[] = []

  for (let index = 0; index < sorted.length; ) {
    const group = [sorted[index]]
    let groupEnd = sorted[index].end
    let nextIndex = index + 1

    while (
      nextIndex < sorted.length &&
      sorted[nextIndex].start < groupEnd
    ) {
      group.push(sorted[nextIndex])
      groupEnd = Math.max(groupEnd, sorted[nextIndex].end)
      nextIndex += 1
    }

    const winner = [...group].sort(
      (left, right) =>
        right.priority - left.priority ||
        right.end - right.start - (left.end - left.start) ||
        left.category.localeCompare(right.category),
    )[0]
    const groupStart = group[0].start
    const winnerCoversGroup =
      winner.start === groupStart && winner.end === groupEnd

    resolved.push({
      ...winner,
      start: groupStart,
      end: groupEnd,
      findingStart: winner.start,
      replacement: winnerCoversGroup
        ? winner.replacement
        : `${redactionLabel(winner.category)}${preserveLineBreaks(
            markdown.slice(groupStart, groupEnd),
          )}`,
    })
    index = nextIndex
  }

  return resolved
}

function lineForIndex(markdown: string, target: number, cursor: number, line: number) {
  let nextCursor = cursor
  let nextLine = line

  while (nextCursor < target) {
    const character = markdown[nextCursor]

    if (character === '\n') {
      nextLine += 1
    } else if (
      character === '\r' &&
      markdown[nextCursor + 1] !== '\n'
    ) {
      nextLine += 1
    }

    nextCursor += 1
  }

  return { cursor: nextCursor, line: nextLine }
}

function applyRedactions(markdown: string, candidates: RedactionCandidate[]) {
  const output: string[] = []
  const findings: HandoffPrivacyFinding[] = []
  let contentCursor = 0
  let lineCursor = 0
  let currentLine = 1

  for (const candidate of candidates) {
    const linePosition = lineForIndex(
      markdown,
      candidate.findingStart ?? candidate.start,
      lineCursor,
      currentLine,
    )
    lineCursor = linePosition.cursor
    currentLine = linePosition.line
    findings.push({
      category: candidate.category,
      line: currentLine,
    })
    output.push(
      markdown.slice(contentCursor, candidate.start),
      candidate.replacement,
    )
    contentCursor = candidate.end
  }

  output.push(markdown.slice(contentCursor))

  return {
    findings,
    redactedMarkdown: output.join(''),
  }
}

export function runHandoffPrivacyPreflight(
  markdown: string,
): HandoffPrivacyPreflightResult {
  if (markdown.length > MAX_HANDOFF_PRIVACY_CHARACTERS) {
    return {
      status: 'blocked',
      reason: 'input-too-large',
      redactedMarkdown: '',
      findings: [],
      checkedCharacters: 0,
      limit: MAX_HANDOFF_PRIVACY_CHARACTERS,
    }
  }

  const collected = collectCandidates(markdown)

  if (collected.blockedReason) {
    return {
      status: 'blocked',
      reason: collected.blockedReason,
      redactedMarkdown: '',
      findings: [],
      checkedCharacters: markdown.length,
      limit: MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS,
    }
  }

  if (collected.overflowed) {
    return {
      status: 'blocked',
      reason: 'finding-limit-exceeded',
      redactedMarkdown: '',
      findings: [],
      checkedCharacters: markdown.length,
      limit: MAX_HANDOFF_PRIVACY_FINDINGS,
    }
  }

  const resolvedCandidates = resolveOverlaps(markdown, collected.candidates)

  if (resolvedCandidates.length > MAX_HANDOFF_PRIVACY_FINDINGS) {
    return {
      status: 'blocked',
      reason: 'finding-limit-exceeded',
      redactedMarkdown: '',
      findings: [],
      checkedCharacters: markdown.length,
      limit: MAX_HANDOFF_PRIVACY_FINDINGS,
    }
  }

  const result = applyRedactions(markdown, resolvedCandidates)

  return {
    status: 'checked',
    redactedMarkdown: result.redactedMarkdown,
    findings: result.findings,
    checkedCharacters: markdown.length,
  }
}
