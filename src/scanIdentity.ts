type FindingIdentityInput = {
  ruleId: string
  title: string
  severity: string
  path: string
  line: number
  message: string
  remediation: string
  evidence?: string
}

function stableHash(value: string) {
  let hash = 0xcbf29ce484222325n

  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }

  return hash.toString(16).padStart(16, '0')
}

export function deriveScanScopeId(scanRoot: string | undefined, sourceName: string) {
  const scopeSource = scanRoot?.trim()
    ? `root\u0000${scanRoot.trim().replaceAll('\\', '/')}`
    : `source\u0000${sourceName.trim().toLowerCase()}`

  return `scope-${stableHash(scopeSource)}`
}

export function canonicalFindingValue(finding: FindingIdentityInput) {
  return JSON.stringify([
    finding.ruleId,
    finding.title,
    finding.severity,
    finding.path,
    finding.line,
    finding.message,
    finding.remediation,
    finding.evidence ?? '',
  ])
}

export function deriveFindingKey(finding: FindingIdentityInput) {
  return `finding-${stableHash(canonicalFindingValue(finding))}`
}
