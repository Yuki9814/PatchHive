export function neutralizeUntrustedMarkdown(value: string) {
  return value
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ⏎ ')
    .replaceAll('&', '&amp;')
    .replaceAll('\\', '\\\\')
    .replaceAll('<', '\\<')
    .replaceAll('>', '\\>')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('!', '\\!')
    .replaceAll('@', '@\u200B')
    .replaceAll('#', '#\u200B')
    .replace(/https?:\/\/[^\s]+/gi, (match) =>
      match
        .replace('://', ':\u200B//')
        .replaceAll('.', '.\u200B'),
    )
    .replace(/www\./gi, (match) => `${match.slice(0, -1)}\u200B.`)
}
