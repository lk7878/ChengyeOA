import { frameSession, inPreviewFrame } from './features/authorization/preview-frame'
import { useAuthStore } from './stores/authStore'
import './random-uuid-polyfill'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import './styles/product-ui.css'

if (inPreviewFrame) {
  const frame=frameSession();
  useAuthStore.setState({bootstrapStatus:'ready',isAuthenticated:!!frame,userInfo:frame ? {id:frame.id,name:frame.name,username:frame.name}:null});
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
