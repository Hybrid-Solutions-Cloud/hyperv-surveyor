import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { prepareStore } from './state/store'
import { consumeSharedLink } from './state/urlState'
import './styles.css'

// Read a shared link before the router starts, and take it out of the address bar so a reload
// keeps local edits instead of re-applying the link.
const shared = consumeSharedLink()
const root = ReactDOM.createRoot(document.getElementById('root')!)

// Nothing that reads the store renders until saved state has loaded and any shared link is
// applied, so defaults never flash and a link is never overwritten by the saved state.
root.render(<div className="boot-screen" role="status">Loading your saved work…</div>)
prepareStore(shared).finally(() => {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <HashRouter>
          <App />
        </HashRouter>
      </ErrorBoundary>
    </React.StrictMode>,
  )
})
