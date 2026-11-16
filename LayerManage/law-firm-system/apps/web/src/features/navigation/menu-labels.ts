import { useMemo } from 'react';
import { businessSources, isBusinessSource, moduleOptions } from '../crm/business-sources';
import { defaultMenu, useMenuStore, type MenuNode } from './menu-store';

// Targets bind existing business routes to stable node IDs; all displayed labels
// and ancestor paths are resolved from the current dictionary, never copied into records.
export function menuLabels(nodes: MenuNode[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const byTarget = new Map(nodes.filter(node => node.target).map(node => [node.target!, node.id]));
  const resolve = (target: string) => {
    const id = byTarget.get(target), labels: string[] = [], ids = new Set<string>();
    let node = id ? byId.get(id) : undefined;
    const leaf = node;
    while (node && !ids.has(node.id)) {
      ids.add(node.id); labels.unshift(node.label);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    return leaf ? { id: leaf.id, label: leaf.label, path: labels.join(' / '), group: labels.slice(0, -1).join(' / ') } : undefined;
  };
  const labelFor = (target: string, fallback: string) => resolve(target)?.label ?? fallback;
  const pathFor = (target: string, fallback: string) => resolve(target)?.path ?? fallback;
  const sourceLabel = (source: string | null | undefined, fallback = '') => source && isBusinessSource(source)
    ? labelFor(businessSources[source].path, fallback || businessSources[source].title) : fallback;
  const sourcePath = (source: string | null | undefined, fallback: string) => source && isBusinessSource(source)
    ? pathFor(businessSources[source].path, fallback) : fallback;
  const sourceGroup = (source: string | null | undefined, fallback: string) => source && isBusinessSource(source)
    ? resolve(businessSources[source].path)?.group || fallback : fallback;
  const sourceGroupKey = (source: string | null | undefined, fallback: string) => {
    const ref = source && isBusinessSource(source) ? resolve(businessSources[source].path) : undefined;
    return ref ? byId.get(ref.id)?.parentId || ref.id : fallback;
  };
  return { resolve, labelFor, pathFor, sourceLabel, sourcePath, sourceGroup, sourceGroupKey,
    moduleOptions: moduleOptions.map(option => ({ ...option, label: sourceLabel(option.value, option.label) })) };
}
export function useMenuLabels() {
  const config = useMenuStore(state => state.config);
  return useMemo(() => menuLabels(config?.nodes ?? defaultMenu()), [config]);
}
