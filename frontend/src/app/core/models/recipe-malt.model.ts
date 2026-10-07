import type { MaltType } from './malt.model';

/**
 * 配方麦芽投料行：配方对麦芽主档的引用（配比在此，色度只在主档）。
 * 记录入库时的色度快照；当主档色度被调整，引用行会被标记 ebcStale，
 * 页面先标出「待重算」，等用户确认重算后再刷新 ebcSnapshot。
 */
export interface RecipeMalt {
  id: string;
  /** 所属配方 */
  recipeId: string;
  /** 麦芽主档 id（唯一出处，不再照名字认） */
  maltId: string;
  /** 用量占比 % */
  ratioPct: number;
  /** 入库登记名（主档名称快照，仅用于主档缺失时展示） */
  nameSnapshot: string;
  /** 入库色度快照 EBC */
  ebcSnapshot: number;
  /** 色度是否已作废待重算（主档色度改过） */
  ebcStale: boolean;
}

/** 重算/迁移时只需的主档字段 */
export interface MaltSnapshotSource {
  name: string;
  ebc: number;
  type: MaltType;
}

export function createEmptyRecipeMalt(): Omit<RecipeMalt, 'id'> {
  return { recipeId: '', maltId: '', ratioPct: 80, nameSnapshot: '', ebcSnapshot: 0, ebcStale: false };
}
