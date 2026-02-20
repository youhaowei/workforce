import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/services/types';
import { useOrgStore } from '@/ui/stores/useOrgStore';
import { useDialogStore } from '@/ui/stores/useDialogStore';
import { ProjectsPanel } from './ProjectsPanel';

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockSetQueriesData = vi.fn();
const mockSetQueryData = vi.fn();
const mockGetQueryData = vi.fn();
const mockDeleteMutate = vi.fn();

const mockProjectListQueryOptions = vi.fn((input, options) => ({ input, options }));
const mockProjectListQueryKey = vi.fn((input) => ['project', 'list', input]);
const mockProjectDeleteMutationOptions = vi.fn((options) => options ?? {});

let capturedDeleteOptions:
  | {
      onMutate?: (input: { id: string }) => { wasSelected: boolean; id: string; previousProjects?: Project[] } | undefined;
      onError?: (error: unknown, vars: { id: string }, context?: { wasSelected: boolean; id: string; previousProjects?: Project[] }) => void;
    }
  | null = null;

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQueryClient: () => ({
    setQueriesData: mockSetQueriesData,
    setQueryData: mockSetQueryData,
    getQueryData: mockGetQueryData,
  }),
}));

vi.mock('@/bridge/react', () => ({
  useTRPC: () => ({
    project: {
      list: {
        queryOptions: mockProjectListQueryOptions,
        queryKey: mockProjectListQueryKey,
      },
      delete: {
        mutationOptions: mockProjectDeleteMutationOptions,
      },
    },
  }),
}));

function makeProject(id: string, name = 'Project A'): Project {
  const now = Date.now();
  return {
    id,
    orgId: 'org_1',
    name,
    rootPath: `/tmp/${id}`,
    color: '#81C784',
    createdAt: now,
    updatedAt: now,
  };
}

describe('ProjectsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgStore.setState({ currentOrgId: null });
    capturedDeleteOptions = null;

    mockUseQuery.mockReturnValue({ data: [], isLoading: false });
    mockUseMutation.mockImplementation((options: Record<string, unknown>) => {
      if ('onMutate' in options || 'onError' in options) {
        capturedDeleteOptions = options as typeof capturedDeleteOptions;
      }
      return { mutate: mockDeleteMutate };
    });
  });

  it('disables project list query until an org is selected', () => {
    render(<ProjectsPanel collapsed={false} />);

    expect(mockProjectListQueryOptions).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: false }),
    );
  });

  it('does not call onSelectProject when Enter is pressed on delete button', () => {
    useOrgStore.setState({ currentOrgId: 'org_1' });
    const onSelectProject = vi.fn();
    mockUseQuery.mockReturnValue({ data: [makeProject('proj_1', 'Alpha')], isLoading: false });

    render(
      <ProjectsPanel
        collapsed={false}
        onSelectProject={onSelectProject}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Delete Alpha'), { key: 'Enter' });

    expect(onSelectProject).not.toHaveBeenCalled();
  });

  it('clears selected project optimistically on delete', () => {
    useOrgStore.setState({ currentOrgId: 'org_1' });
    const onClearSelection = vi.fn();
    mockUseQuery.mockReturnValue({ data: [makeProject('proj_1', 'Alpha')], isLoading: false });

    render(
      <ProjectsPanel
        collapsed={false}
        selectedProjectId="proj_1"
        onClearSelection={onClearSelection}
      />,
    );

    const context = capturedDeleteOptions?.onMutate?.({ id: 'proj_1' });
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(context).toMatchObject({ wasSelected: true, id: 'proj_1' });
  });

  it('restores selection and cache snapshot on delete error', () => {
    useOrgStore.setState({ currentOrgId: 'org_1' });
    const onClearSelection = vi.fn();
    const onSelectProject = vi.fn();
    const projectList = [makeProject('proj_1', 'Alpha')];
    mockUseQuery.mockReturnValue({ data: projectList, isLoading: false });
    mockGetQueryData.mockReturnValue(projectList);

    render(
      <ProjectsPanel
        collapsed={false}
        selectedProjectId="proj_1"
        onClearSelection={onClearSelection}
        onSelectProject={onSelectProject}
      />,
    );

    const context = capturedDeleteOptions?.onMutate?.({ id: 'proj_1' });
    expect(onClearSelection).toHaveBeenCalledTimes(1);

    capturedDeleteOptions?.onError?.(new Error('delete failed'), { id: 'proj_1' }, context ?? undefined);
    expect(mockSetQueryData).toHaveBeenCalledWith(
      expect.anything(),
      projectList,
    );
    expect(onSelectProject).toHaveBeenCalledWith('proj_1');
  });

  it('does not restore selection on error if a different project was deleted', () => {
    useOrgStore.setState({ currentOrgId: 'org_1' });
    const onSelectProject = vi.fn();
    const projectList = [makeProject('proj_1', 'Alpha'), makeProject('proj_2', 'Beta')];
    mockUseQuery.mockReturnValue({ data: projectList, isLoading: false });
    mockGetQueryData.mockReturnValue(projectList);

    render(
      <ProjectsPanel
        collapsed={false}
        selectedProjectId="proj_1"
        onSelectProject={onSelectProject}
      />,
    );

    const context = capturedDeleteOptions?.onMutate?.({ id: 'proj_2' });
    expect(context).toMatchObject({ wasSelected: false, id: 'proj_2' });

    capturedDeleteOptions?.onError?.(new Error('delete failed'), { id: 'proj_2' }, context ?? undefined);
    expect(onSelectProject).not.toHaveBeenCalled();
  });

  describe('confirm dialog integration', () => {
    it('calls confirm dialog when delete button is clicked', async () => {
      useOrgStore.setState({ currentOrgId: 'org_1' });
      const confirmSpy = vi.fn().mockResolvedValue(true);
      useDialogStore.setState({ confirm: confirmSpy } as never);
      // getState().confirm needs to be spied on
      vi.spyOn(useDialogStore, 'getState').mockReturnValue({
        ...useDialogStore.getState(),
        confirm: confirmSpy,
      });

      mockUseQuery.mockReturnValue({ data: [makeProject('proj_1', 'Alpha')], isLoading: false });

      render(<ProjectsPanel collapsed={false} />);

      fireEvent.click(screen.getByLabelText('Delete Alpha'));

      // confirm should be called with destructive dialog options
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Delete project',
          variant: 'destructive',
        }),
      );
    });

    it('calls deleteMutation.mutate when user confirms', async () => {
      useOrgStore.setState({ currentOrgId: 'org_1' });
      const confirmSpy = vi.fn().mockResolvedValue(true);
      vi.spyOn(useDialogStore, 'getState').mockReturnValue({
        ...useDialogStore.getState(),
        confirm: confirmSpy,
      });

      mockUseQuery.mockReturnValue({ data: [makeProject('proj_1', 'Alpha')], isLoading: false });

      render(<ProjectsPanel collapsed={false} />);

      fireEvent.click(screen.getByLabelText('Delete Alpha'));

      // Wait for the async confirm to resolve
      await vi.waitFor(() => {
        expect(mockDeleteMutate).toHaveBeenCalledWith({ id: 'proj_1' });
      });
    });

    it('does not call deleteMutation.mutate when user cancels', async () => {
      useOrgStore.setState({ currentOrgId: 'org_1' });
      const confirmSpy = vi.fn().mockResolvedValue(false);
      vi.spyOn(useDialogStore, 'getState').mockReturnValue({
        ...useDialogStore.getState(),
        confirm: confirmSpy,
      });

      mockUseQuery.mockReturnValue({ data: [makeProject('proj_1', 'Alpha')], isLoading: false });

      render(<ProjectsPanel collapsed={false} />);

      fireEvent.click(screen.getByLabelText('Delete Alpha'));

      // Wait for the async confirm to resolve, then verify mutate was NOT called
      await vi.waitFor(() => {
        expect(confirmSpy).toHaveBeenCalled();
      });
      expect(mockDeleteMutate).not.toHaveBeenCalled();
    });
  });
});
