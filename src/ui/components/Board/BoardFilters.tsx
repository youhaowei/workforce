/**
 * BoardFilters - Filter bar for the supervision board.
 * Provides debounced keyword search and status filtering.
 */

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search } from 'lucide-react';

interface BoardFiltersProps {
  keyword: string;
  onKeywordChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'created', label: 'Created' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function BoardFilters({
  keyword,
  onKeywordChange,
  statusFilter,
  onStatusFilterChange,
}: BoardFiltersProps) {
  const [localKeyword, setLocalKeyword] = useState(keyword);

  // Sync local state when parent resets keyword externally
  useEffect(() => {
    setLocalKeyword(keyword);
  }, [keyword]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onKeywordChange(localKeyword);
    }, 300);
    return () => clearTimeout(timer);
  }, [localKeyword, onKeywordChange]);

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-64">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter agents..."
          value={localKeyword}
          onChange={(e) => setLocalKeyword(e.target.value)}
          className="pl-9 h-9"
        />
      </div>
      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="w-40 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
