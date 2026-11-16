import { menuLabels } from '@/features/navigation/menu-labels';
export const presetNames: Record<string,string> = {OWNER:'所有者',MANAGER:'管理员',EDITOR:'编辑者',READER:'阅读者'};
export type TableOption = {id:string;name:string;base:{id:string;name:string;moduleSource?:string|null;workspace:{name:string}}};
export const tableOptions = (tables:TableOption[], labels = menuLabels([])) => tables.map(t=>({value:t.id,label:labels.sourcePath(t.base.moduleSource,[t.base.workspace.name,t.base.name].join(' / '))+' / '+t.name}));
export const previewEvent = 'oa:worksheet-permission-preview';
