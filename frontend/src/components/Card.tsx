// Card — small titled value card used across dashboard panels.
export function Card({ title, value }: { title: string; value: string }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}
    >
      <div className="text-sm opacity-80">{title}</div>
      <div className="text-lg mt-1" style={{ fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

