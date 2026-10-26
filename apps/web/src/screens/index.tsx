import { useParams } from 'react-router';
import { Placeholder } from './Placeholder';

export const NeedsYou = () => (
  <Placeholder title="Needs you" purpose="Decisions, gates and manual tasks waiting for you, across projects." />
);

export const Library = () => (
  <Placeholder title="Agents & Pipelines" purpose="Agents, pipelines and how well each version performs." />
);

export function Task() {
  const { taskId = '' } = useParams();
  return <Placeholder title={`Task ${taskId}`} purpose="Where the task is in its pipeline, and every decision made on it." />;
}

export const NotFound = () => <Placeholder title="Not found" purpose="There is nothing at this address." />;
