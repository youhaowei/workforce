import {createLazyFileRoute} from '@tanstack/react-router';
import {ReviewQueue} from '../components/Review';

export const Route = createLazyFileRoute('/queue')({
  component: ReviewQueue,
});
