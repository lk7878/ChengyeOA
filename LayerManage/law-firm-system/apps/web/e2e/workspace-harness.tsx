import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import ChineseConfig from '../src/components/ChineseConfig';
import WorkspacesPage from '../src/pages/Workspaces';
import { runtimeSession } from '../src/features/auth/runtime-session';
import type { AuthenticatedData } from '../src/features/auth/types';

// Only this test entry accepts a session created in the isolated acceptance database.
declare global {
  interface Window {
    collabTestSession: AuthenticatedData;
  }
}
runtimeSession.setAuthenticated(window.collabTestSession);
createRoot(document.getElementById('root')!).render(
  <ChineseConfig>
    <BrowserRouter>
      <WorkspacesPage />
    </BrowserRouter>
  </ChineseConfig>,
);
