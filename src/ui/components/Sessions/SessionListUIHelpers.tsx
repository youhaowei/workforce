/**
 * UI helpers for SessionList — extracted to reduce file size.
 * Exports component-based filter dropdown.
 */

import React from "react";
import { ChevronDown, Calendar } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// =============================================================================
// Filter Dropdown
// =============================================================================

export function FilterDropdown<T extends string>({
  label,
  icon: Icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: typeof Calendar;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const active = value !== "all";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center gap-1 h-6 px-1.5 rounded text-[11px] transition-colors ${
            active
              ? "bg-palette-primary/10 text-palette-primary font-medium"
              : "text-neutral-fg-subtle hover:text-neutral-fg hover:bg-neutral-bg-dim/50"
          }`}
        >
          <Icon className="h-3 w-3" />
          {active ? options.find((o) => o.value === value)?.label : label}
          <ChevronDown className="h-2.5 w-2.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[100px]">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((opt) => (
            <DropdownMenuRadioItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
