'use client'

import React from 'react'

interface State {
  hasError: boolean
}

/**
 * Catches render-time crashes (e.g. a corrupted persisted blob) and offers a
 * recovery path instead of a blank white screen.
 */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('Daily Rep crashed:', error)
  }

  private hardReset = () => {
    try {
      window.localStorage.removeItem('daily-rep-v1')
    } catch {
      /* ignore */
    }
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="mx-auto max-w-md min-h-full flex flex-col items-center justify-center px-6 text-center safe-top safe-bottom">
        <div className="text-5xl mb-4">😵‍💫</div>
        <h1 className="text-xl font-extrabold">Something went wrong</h1>
        <p className="text-sm text-fg/55 mt-2">
          The app hit an unexpected error. Reloading usually fixes it — if not, resetting your local
          data will.
        </p>
        <button onClick={() => window.location.reload()} className="btn-ghost mt-6 w-full">
          Reload
        </button>
        <button onClick={this.hardReset} className="btn-primary mt-3 w-full">
          Reset app data
        </button>
      </div>
    )
  }
}
