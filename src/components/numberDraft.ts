/**
 * Number field behaviour. A field stays as typed, including empty, and only a valid value reaches
 * the design. Treating an empty field as 0 used to make every result infeasible mid-edit.
 */
export function parseNumberDraft(draft: string, min?: number, max?: number): number | null {
  if (draft.trim() === '') return null
  const value = Number(draft)
  if (!Number.isFinite(value)) return null
  if (min !== undefined && value < min) return null
  if (max !== undefined && value > max) return null
  return value
}

export function numberDraftProblem(draft: string, min?: number, max?: number): string | null {
  if (parseNumberDraft(draft, min, max) !== null) return null
  if (min !== undefined && max !== undefined) return `Enter a number from ${min} to ${max}.`
  if (min !== undefined) return `Enter ${min} or more.`
  if (max !== undefined) return `Enter ${max} or less.`
  return 'Enter a number.'
}

/** Removes floating-point noise such as 7.000000000000001 from a percentage. */
export function formatNumberDraft(value: number): string {
  return String(Number((Number.isFinite(value) ? value : 0).toPrecision(12)))
}
