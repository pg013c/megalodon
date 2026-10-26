import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface UiState {
  connectOpen: boolean;
  setConnectOpen: (open: boolean) => void;
  newItemOpen: boolean;
  setNewItemOpen: (open: boolean) => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean | ((open: boolean) => boolean)) => void;
}

const Context = createContext<UiState | null>(null);

/** App-wide UI state that several places open (the palette, the switcher, empty states). */
export function UiStateProvider({ children }: { children: ReactNode }) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const value = useMemo(
    () => ({ connectOpen, setConnectOpen, newItemOpen, setNewItemOpen, chatOpen, setChatOpen }),
    [connectOpen, newItemOpen, chatOpen],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useUiState(): UiState {
  const value = useContext(Context);
  if (!value) throw new Error('useUiState outside UiStateProvider');
  return value;
}
