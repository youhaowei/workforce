/**
 * ProjectForm — Shared form fields for creating and editing projects.
 *
 * Renders name, root path (with native directory picker in desktop mode),
 * and color swatch picker. The parent dialog provides initial values,
 * submit handling, and the dialog chrome (title, footer buttons).
 */

import { useState, useMemo } from 'react';
import { FolderOpen, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { PALETTE, colorFromName } from '@/shared/palette';
import { useDirectoryPicker } from '@/ui/hooks/useDirectoryPicker';

export interface ProjectFormValues {
  name: string;
  rootPath: string;
  color: string;
}

interface ProjectFormProps {
  initialValues?: Partial<ProjectFormValues>;
  /** Called on valid form submission with trimmed values. */
  onSubmit: (values: ProjectFormValues) => void;
  /** Disables the submit button (e.g. while a mutation is in-flight). */
  isPending?: boolean;
  /** Additional disable condition beyond form validation (e.g. missing orgId). */
  disabled?: boolean;
  submitLabel?: string;
  pendingLabel?: string;
  onCancel: () => void;
}

export function ProjectForm({
  initialValues,
  onSubmit,
  isPending = false,
  disabled = false,
  submitLabel = 'Create',
  pendingLabel = 'Creating...',
  onCancel,
}: ProjectFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [rootPath, setRootPath] = useState(initialValues?.rootPath ?? '');
  const [selectedColor, setSelectedColor] = useState<string | null>(
    initialValues?.color ?? null,
  );

  const { pick, isPicking } = useDirectoryPicker();

  const autoColor = useMemo(() => (name ? colorFromName(name) : PALETTE[0]), [name]);
  const activeColor = selectedColor ?? autoColor;

  const handleBrowse = async () => {
    if (!pick) return;
    const selected = await pick();
    if (selected) setRootPath(selected);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !rootPath.trim()) return;
    onSubmit({
      name: name.trim(),
      rootPath: rootPath.trim(),
      color: activeColor,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="project-name">Name</Label>
        <Input
          id="project-name"
          placeholder="My Project"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-path">Root Path</Label>
        <div className="flex gap-2">
          <Input
            id="project-path"
            placeholder="/path/to/project"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            className="font-mono text-sm flex-1"
          />
          {pick && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0 h-9 w-9"
              onClick={handleBrowse}
              disabled={isPicking}
              aria-label="Browse for directory"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Absolute path to the project directory
        </p>
      </div>

      <div className="space-y-2">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setSelectedColor(color)}
              className="w-7 h-7 rounded-md transition-transform hover:scale-110 flex items-center justify-center"
              style={{ backgroundColor: color }}
              aria-label={`Select color ${color}`}
            >
              {color === activeColor && (
                <Check className="h-3.5 w-3.5 text-white" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || !rootPath.trim() || isPending || disabled}
        >
          {isPending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
