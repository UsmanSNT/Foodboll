import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly children: (props: { id: string; 'aria-describedby': string | undefined; 'aria-invalid': true | undefined }) => ReactNode;
}

/** Label + control + hint/error, wired together for assistive technology. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': note ? noteId : undefined, 'aria-invalid': error ? true : undefined })}
      {note && (
        <p id={noteId} className="field__hint" style={error ? { color: 'var(--danger)' } : undefined}>
          {note}
        </p>
      )}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={['input', props.className].filter(Boolean).join(' ')} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={['textarea', props.className].filter(Boolean).join(' ')} />;
}
