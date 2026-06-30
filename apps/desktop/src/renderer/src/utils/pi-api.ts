export function getPiAPI(): Window["piAPI"] | undefined {
  return typeof window !== "undefined" ? window.piAPI : undefined
}
