/**
 * SkillsToolsSelector - Multi-select command palette for picking skills and tools.
 *
 * Used in TemplateEditor and OrgSettings for selecting available tools/skills.
 * Uses shadcn Command component for searchable multi-select.
 */

import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronsUpDown, X } from 'lucide-react';

interface SkillsToolsSelectorProps {
  label: string;
  items: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

export function SkillsToolsSelector({
  label,
  items,
  selected,
  onChange,
  placeholder = 'Select items...',
}: SkillsToolsSelectorProps) {
  const [open, setOpen] = useState(false);

  const available = useMemo(
    () => items.filter((item) => !selected.includes(item)),
    [items, selected],
  );

  const handleSelect = (item: string) => {
    onChange([...selected, item]);
  };

  const handleRemove = (item: string) => {
    onChange(selected.filter((s) => s !== item));
  };

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">{label}</span>

      {/* Selected badges */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((item) => (
            <Badge key={item} variant="soft" className="text-xs gap-1 pr-1">
              {item}
              <button
                type="button"
                onClick={() => handleRemove(item)}
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Command popover */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-between text-xs">
            {placeholder}
            <ChevronsUpDown className="h-3 w-3 ml-1 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}...`} className="h-8" />
            <CommandList>
              <CommandEmpty>No items found.</CommandEmpty>
              <CommandGroup>
                {available.map((item) => (
                  <CommandItem
                    key={item}
                    value={item}
                    onSelect={() => handleSelect(item)}
                    className="text-xs"
                  >
                    {item}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
