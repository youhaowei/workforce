import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ShellProvider, type ShellContextValue } from "@/ui/context/ShellContext";
import { CreateProjectDialog } from "../Project";
import { AgentQuestionDialog } from "./AgentQuestionDialog";
import { ConfirmDialog } from "./ConfirmDialog";

interface ShellProvidersProps {
  children: ReactNode;
  contextValue: ShellContextValue;
  createProjectDialogOpen: boolean;
  onProjectDialogOpenChange: (open: boolean) => void;
  onProjectCreated: (projectId: string) => void;
}

export function ShellProviders({
  children,
  contextValue,
  createProjectDialogOpen,
  onProjectDialogOpenChange,
  onProjectCreated,
}: ShellProvidersProps) {
  return (
    <ShellProvider value={contextValue}>
      <TooltipProvider>
        {children}
        <CreateProjectDialog
          open={createProjectDialogOpen}
          onOpenChange={onProjectDialogOpenChange}
          onCreated={onProjectCreated}
        />
        <ConfirmDialog />
        <AgentQuestionDialog />
      </TooltipProvider>
    </ShellProvider>
  );
}
