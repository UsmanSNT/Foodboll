import { useParams } from 'react-router-dom';
import { LegalEditor } from './settings/legal/LegalEditor';
import { LegalList } from './settings/legal/LegalList';

/** Terms, privacy, cancellation and refund policy: `/admin/legal` lists them, `/admin/legal/:type` edits one. */
export function AdminLegalPage() {
  const { type } = useParams();
  return type === undefined ? <LegalList /> : <LegalEditor rawType={type} />;
}
