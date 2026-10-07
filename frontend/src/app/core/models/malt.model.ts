/** 麦芽类型 */
export type MaltType = '基础麦芽' | '特种麦芽' | '烤制麦芽';

/**
 * 麦芽主档：入库登记的原料，色度 / α 酸调整的唯一出处。
 * 配方色度只认主档 id，不再按名字复制色度。
 */
export interface MaltCatalog {
  id: string;
  /** 名称 */
  name: string;
  /** 色度 EBC */
  ebc: number;
  /** 产地 */
  origin: string;
  /** 类型 */
  type: MaltType;
}

/** 配方麦芽（用量行）：引用麦芽主档，色度随主档走 */
export interface RecipeMalt {
  id: string;
  /** 所属配方 */
  recipeId: string;
  /** 麦芽主档 id */
  maltId: string;
  /** 名称（主档名称快照，仅用于主档缺失时展示） */
  name: string;
  /** 用量占比 % */
  ratioPct: number;
  /** 主档色度改动后尚未按新值重算：true 时配方色度偏差作废，待页面确认重算 */
  stale?: boolean;
}

export const MALT_TYPES: MaltType[] = ['基础麦芽', '特种麦芽', '烤制麦芽'];

export function createEmptyMaltCatalog(): Omit<MaltCatalog, 'id'> {
  return { name: '', ebc: 4, origin: '', type: '基础麦芽' };
}

export function createEmptyRecipeMalt(): Omit<RecipeMalt, 'id'> {
  return { recipeId: '', maltId: '', name: '', ratioPct: 80, stale: false };
}
