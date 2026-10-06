import type { RegionNodeDto } from '@foodboll/contracts';
import { useRegionTree } from '../api/queries';
import { useI18n } from '../i18n/I18nProvider';
import { useRegion } from './RegionProvider';

function find(
  nodes: readonly RegionNodeDto[],
  code: string,
): { node: RegionNodeDto; parent: RegionNodeDto | null } | null {
  for (const node of nodes) {
    if (node.code === code) return { node, parent: null };
    const child = node.children.find((c) => c.code === code);
    if (child) return { node: child, parent: node };
  }
  return null;
}

/** Display name of a region code (`Gyeonggi Suwon`), or the "all regions" label for null. */
export function useRegionLabel(code: string | null): string {
  const { t } = useI18n();
  const { homeRegion } = useRegion();
  const tree = useRegionTree();
  if (code === null) return t('region.all');
  const found = tree.data ? find(tree.data.items, code) : null;
  if (found) {
    return found.parent
      ? `${found.parent.name.text} ${found.node.name.text}`
      : found.node.name.text;
  }
  if (homeRegion?.code === code) {
    return homeRegion.parent
      ? `${homeRegion.parent.name.text} ${homeRegion.name.text}`
      : homeRegion.name.text;
  }
  return tree.isPending ? t('common.loading') : t('region.all');
}
