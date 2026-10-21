import { createContext, useContext } from 'react';

export interface ShellCtx {
  openDrawer: () => void;
  goBack: () => void;
}

export const ShellContext = createContext<ShellCtx>({ openDrawer: () => undefined, goBack: () => undefined });
export const useShell = () => useContext(ShellContext);
