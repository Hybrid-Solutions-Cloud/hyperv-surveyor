import React from 'react'

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="content-wrap" style={{ paddingTop: 48 }}>
        <section className="panel">
          <h1>Surveyor could not display this design</h1>
          <div className="note err"><strong>A local application error occurred</strong>{this.state.error.message}</div>
          <p>Your project data remains in this browser. Reload first; if the problem returns, open a previously downloaded project file after the application loads.</p>
          <button className="btn" onClick={() => window.location.reload()}>Reload Surveyor</button>
        </section>
      </main>
    )
  }
}
