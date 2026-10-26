import { Link } from 'react-router';
import { useTaskDetails } from '../../data/work';
import { taskPath } from '../../shell/screens';
import { ErrorText } from '../../ui/Field';
import { Drawer } from '../../ui/Overlay';
import { TaskDetailsView } from '../task/TaskDetailsView';

export function TaskDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const details = useTaskDetails(id);
  const task = details.data?.task;
  return (
    <Drawer
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      title={task ? task.title : ''}
      description={task ? `#${task.number}` : undefined}
    >
      <ErrorText error={details.error} />
      {details.data && (
        <>
          <TaskDetailsView details={details.data} />
          <Link to={taskPath(details.data.task.id)} className="mt-8 inline-block text-[13px] text-accent">
            Open task page →
          </Link>
        </>
      )}
    </Drawer>
  );
}
