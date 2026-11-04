/** The branch name as stored: trimmed, and an empty one means "no name" (the panel shows only the number). */
export function toBranchName(value: string): string | null {
  return value.trim() || null
}
