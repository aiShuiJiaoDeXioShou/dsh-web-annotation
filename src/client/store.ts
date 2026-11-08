/** Tiny observable store used by the controller and the React surface. */
export interface Store<T> {
  get(): T
  set(patch: Partial<T> | ((state: T) => Partial<T> | null)): void
  subscribe(listener: () => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get() {
      return state
    },
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch
      if (next === null || next === undefined) return
      const merged = Object.assign({}, state, next) as T
      if (merged === state) return
      state = merged
      for (const listener of listeners) {
        try {
          listener()
        } catch {
          /* a broken subscriber must not break the state machine */
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
