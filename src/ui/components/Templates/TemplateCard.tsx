/**
 * TemplateCard - Card displaying an agent template with quick actions.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, Play, Copy, Pencil, Archive } from 'lucide-react';
import type { AgentTemplate } from '@/services/types';

interface TemplateCardProps {
  template: AgentTemplate;
  onLaunch?: (template: AgentTemplate) => void;
  onEdit?: (template: AgentTemplate) => void;
  onDuplicate?: (template: AgentTemplate) => void;
  onArchive?: (template: AgentTemplate) => void;
}

function reasoningColor(intensity: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (intensity) {
    case 'max': return 'destructive';
    case 'high': return 'default';
    case 'medium': return 'secondary';
    default: return 'outline';
  }
}

export function TemplateCard({ template, onLaunch, onEdit, onDuplicate, onArchive }: TemplateCardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium truncate">{template.name}</h3>
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{template.description}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit?.(template)}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate?.(template)}>
                <Copy className="h-3.5 w-3.5 mr-2" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onArchive?.(template)} className="text-destructive">
                <Archive className="h-3.5 w-3.5 mr-2" />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <Badge variant={reasoningColor(template.reasoningIntensity)} className="text-[10px]">
            {template.reasoningIntensity}
          </Badge>
          {template.skills.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {template.skills.length} skills
            </Badge>
          )}
          {template.tools.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {template.tools.length} tools
            </Badge>
          )}
        </div>

        <Button size="sm" className="w-full" onClick={() => onLaunch?.(template)}>
          <Play className="h-3 w-3 mr-1.5" />
          Launch
        </Button>
      </CardContent>
    </Card>
  );
}
