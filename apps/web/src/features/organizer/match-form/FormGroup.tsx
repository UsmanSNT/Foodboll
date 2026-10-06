import type { ReactNode } from 'react';

interface FormGroupProps {
  readonly legend: string;
  readonly disabled: boolean;
  readonly children: ReactNode;
}

/** A titled group of related fields: a fieldset, so assistive technology announces the group name. */
export function FormGroup({ legend, disabled, children }: FormGroupProps) {
  return (
    <fieldset className="mf-group" disabled={disabled}>
      <legend className="section-title">{legend}</legend>
      <div className="card card--pad stack">{children}</div>
    </fieldset>
  );
}
