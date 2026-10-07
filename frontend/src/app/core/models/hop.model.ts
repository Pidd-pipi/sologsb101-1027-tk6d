/** 酒花形态 */
export type HopForm = '颗粒' | '整花' | '浸膏';

/**
 * 酒花主档：入库登记的原料，α 酸的唯一出处。
 * 煮沸苦度只认主档 id，不再按名字认 α 酸。
 */
export interface HopCatalog {
  id: string;
  /** 名称 */
  name: string;
  /** α 酸 % */
  alphaPct: number;
  /** 产地 */
  origin: string;
  /** 形态 */
  form: HopForm;
}

/** 配方酒花（用量行）：引用酒花主档，α 酸随主档走 */
export interface HopUsage {
  id: string;
  /** 所属配方 */
  recipeId: string;
  /** 酒花主档 id */
  hopId: string;
  /** 名称（主档名称快照，仅用于主档缺失时展示） */
  name: string;
  /** 用量 g */
  amountG: number;
  /** 主档 α 酸改动后尚未按新值重算：true 时煮沸苦度作废，待页面确认重算 */
  stale?: boolean;
}

export const HOP_FORMS: HopForm[] = ['颗粒', '整花', '浸膏'];

export function createEmptyHopCatalog(): Omit<HopCatalog, 'id'> {
  return { name: '', alphaPct: 12, origin: '', form: '颗粒' };
}

export function createEmptyHopUsage(): Omit<HopUsage, 'id'> {
  return { recipeId: '', hopId: '', name: '', amountG: 30, stale: false };
}
