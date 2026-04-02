import {createLazyFileRoute} from '@tanstack/react-router';
import {WorkflowListView} from '../components/Workflows';

export const Route = createLazyFileRoute('/workflows')({
  component: WorkflowListView,
});
