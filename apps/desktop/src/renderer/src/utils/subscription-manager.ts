export function createSubscriptionManager() {
  let subscribed = false
  const unsubscribers: Array<() => void> = []

  function ensure(setup: () => (() => void) | Array<(() => void)> | void): void {
    if (subscribed) return
    subscribed = true
    const result = setup()
    if (typeof result === "function") {
      unsubscribers.push(result)
    } else if (Array.isArray(result)) {
      unsubscribers.push(...result)
    }
  }

  function cleanup(): void {
    subscribed = false
    while (unsubscribers.length > 0) {
      const fn = unsubscribers.pop()
      fn?.()
    }
  }

  return { ensure, cleanup, get isSubscribed() { return subscribed } }
}
