/** 麦芽类型 */
export type MaltType = '基础麦芽' | '特种麦芽' | '烤制麦芽';

/**
 * 麦芽主档（辅料库）
 * 主档是色度的唯一出处：配方麦芽投料行引用主档 id，主档色度一改，
 * 引用方（配方加权色度 / 色度偏差）的缓存结果立即作废并标为待重算。
 */
export interface Malt {
  id: string;
  /** 名称（入库登记名） */
  name: string;
  /** 色度 EBC */
  ebc: number;
  /** 产地 */
  origin: string;
  /** 类型 */
  type: MaltType;
}

export const MALT_TYPES: MaltType[] = ['基础麦芽', '特种麦芽', '烤制麦芽'];

export function createEmptyMalt(): Omit<Malt, 'id'> {
  return { name: '', ebc: 4, origin: '', type: '基础麦芽' };
}
