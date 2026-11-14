import { createContext, useContext } from 'react';
export const UnifiedShellContext = createContext(false);
export const useUnifiedShell = () => useContext(UnifiedShellContext);
