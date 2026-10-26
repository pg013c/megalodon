/** An empty screen: one title, one sentence about what will live here. */
export function Placeholder({ title, purpose }: { title: string; purpose: string }) {
  return (
    <section>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-xl text-[15px] text-muted">{purpose}</p>
    </section>
  );
}
