import { useState, type FormEvent } from 'react';

interface Props {
  onCreate: (input: { title: string; description: string | null }) => Promise<void>;
}

export function TaskForm({ onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await onCreate({ title: title.trim(), description: description.trim() || null });
    setBusy(false);
    setTitle('');
    setDescription('');
  };

  return (
    <form className="card task-form" onSubmit={(e) => void submit(e)}>
      <input
        aria-label="Title"
        placeholder="What needs doing?"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <input
        aria-label="Description"
        placeholder="Details (optional)"
        value={description}
        maxLength={2000}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button className="primary" type="submit" disabled={busy || !title.trim()}>
        {busy ? 'Adding…' : 'Add task'}
      </button>
    </form>
  );
}
