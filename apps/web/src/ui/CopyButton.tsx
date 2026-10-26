import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard';
import { Button } from './Button';

const RESET_MS = 1500;

/** A button that copies `text` and briefly confirms it ("Copied") or says the copy failed. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    clearTimeout(timer.current);
    const ok = await copyText(text);
    // The write may settle after unmount; a timer started then would never be cleared.
    if (!mounted.current) return;
    clearTimeout(timer.current);
    setState(ok ? 'copied' : 'failed');
    timer.current = setTimeout(() => setState('idle'), RESET_MS);
  }

  return (
    <Button className={className} onClick={copy} aria-live="polite">
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  );
}
