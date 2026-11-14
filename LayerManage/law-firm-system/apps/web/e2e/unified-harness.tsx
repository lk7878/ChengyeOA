import { createRoot } from 'react-dom/client';
import App from '../src/App';
import '../src/index.css';
import { useAuthStore } from '../src/stores/authStore';
import type { AuthenticatedData } from '../src/features/auth/types';

// Used only by the isolated browser-test Vite plugin; production main.tsx never reads this value.
declare global {
  interface Window {
    unifiedTestSession: AuthenticatedData;
    unifiedAssistantOpens: number;
  }
}
useAuthStore.getState().setAuthenticated(window.unifiedTestSession);
createRoot(document.getElementById('root')!).render(<App />);
