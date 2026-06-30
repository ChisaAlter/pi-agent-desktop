import { isIpcError, type IpcError } from "@shared"

export function partition<T>(
  result: T | IpcError
): { ok: true; data: T } | { ok: false; err: IpcError } {
  if (isIpcError(result)) return { ok: false, err: result }
  return { ok: true, data: result }
}
