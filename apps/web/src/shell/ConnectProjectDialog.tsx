import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useConnectProject, useSetActiveProject } from '../data/projects';
import { Button } from '../ui/Button';
import { ErrorText, Field, Input } from '../ui/Field';
import { Modal } from '../ui/Overlay';
import { useUiState } from './UiState';

export function ConnectProjectDialog() {
  const { connectOpen, setConnectOpen } = useUiState();
  const [path, setPath] = useState('');
  const connect = useConnectProject();
  const setActive = useSetActiveProject();
  const navigate = useNavigate();

  const close = (open: boolean) => {
    setConnectOpen(open);
    if (!open) {
      setPath('');
      connect.reset();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const project = await connect.mutateAsync(path);
    await setActive.mutateAsync(project.id);
    close(false);
    navigate('/project/settings');
  };

  return (
    <Modal
      open={connectOpen}
      onOpenChange={close}
      title="Connect project"
      description="The root of a local git repository. Megalodon never writes to it except to merge finished tasks."
    >
      <form onSubmit={(e) => void submit(e).catch(() => {})} className="space-y-4">
        <Field label="Repository path">
          <Input autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/ws/my-project" spellCheck={false} />
        </Field>
        <ErrorText error={connect.error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!path.trim() || connect.isPending}>
            {connect.isPending ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
