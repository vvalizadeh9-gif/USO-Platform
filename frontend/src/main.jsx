import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { applyMotionPreference } from './lib/motionPreference'
import './styles/app.css'
import './styles/kpi-strip.css'
import './styles/dt-dashboard.css'
import './styles/uep-tokens.css'
import './styles/signin.css'

// Before the first render, so no animation starts that should not.
applyMotionPreference()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
