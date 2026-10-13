/** `Producer.staffNames` is stored as one comma-separated string ("Mili, Milagros"). */
export function parseStaffNames(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
}

/** Trims, drops empty and repeated names (case-insensitive); null when none is left. */
export function serializeStaffNames(names: string[]): string | null {
  const seen = new Set<string>()
  const unique = names
    .map(name => name.trim())
    .filter(name => {
      const key = name.toLowerCase()
      if (!name || seen.has(key)) return false
      seen.add(key)
      return true
    })
  return unique.length ? unique.join(', ') : null
}
