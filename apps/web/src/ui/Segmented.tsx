export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full bg-line/60 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-full px-4 py-1 text-[13px] ${value === option.value ? 'bg-surface font-medium shadow-sm' : 'text-muted hover:text-ink'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
