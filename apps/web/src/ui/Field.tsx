import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

const control =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:bg-surface';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={`${control} ${props.className ?? ''}`} />;

export const TextArea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={3} {...props} className={`${control} font-mono ${props.className ?? ''}`} />
);

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-[13px] text-[#ff3b30]">{error instanceof Error ? error.message : String(error)}</p>;
}
