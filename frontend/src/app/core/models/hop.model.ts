/** 酒花形态 */
export type HopForm = '颗粒' | '整花' | '浸膏';

/**
 * 酒花主档（辅料库）
 * 主档是 α 酸的唯一出处：煮沸投花按 hopId 引用主档，主档 α 酸一改，
 * 引用方（煮沸苦度 / IBU）的缓存结果立即作废并标为待重算。
 */
export interface Hop {
  id: string;
  /** 名称（入库登记名） */
  name: string;
  /** α 酸 % */
  alphaPct: number;
  /** 产地 */
  origin: string;
  /** 形态 */
  form: HopForm;
}

export const HOP_FORMS: HopForm[] = ['颗粒', '整花', '浸膏'];

export function createEmptyHop(): Omit<Hop, 'id'> {
  return { name: '', alphaPct: 12, origin: '', form: '颗粒' };
}
