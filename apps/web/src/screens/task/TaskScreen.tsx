import { useParams } from 'react-router';
import { useTaskDetails } from '../../data/work';
import { ErrorText } from '../../ui/Field';
import { TaskDetailsView } from './TaskDetailsView';

/** The Task screen; it will grow into the run timeline (PRD FR-12). */
export function TaskScreen() {
  const { taskId = '' } = useParams();
  const details = useTaskDetails(taskId);
  if (details.error) return <ErrorText error={details.error} />;
  if (!details.data) return null;
  const { task } = details.data;
  return (
    <section className="max-w-3xl">
      <p className="text-[13px] text-muted">#{task.number}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{task.title}</h1>
      <div className="mt-6">
        <TaskDetailsView details={details.data} />
      </div>
    </section>
  );
}
