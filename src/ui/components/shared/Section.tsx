export function Section({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-neutral-fg-subtle flex items-center gap-1 select-none">
        {icon}
        {label}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
