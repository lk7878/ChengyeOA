import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/app.css'

const el = document.getElementById('root')
if (el === null) throw new Error('work_ui: missing #root')
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
