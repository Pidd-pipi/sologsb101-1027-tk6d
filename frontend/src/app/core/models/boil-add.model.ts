/** 投加用途 */
export type BoilPurpose = '苦味' | '风味' | '香气' | '澄清';

/**
 * 煮沸投加：按倒计时排序生成投花时间表
 * - 投花认酒花主档：hopId 指向 hops 主档，不再照 material 名字认；
 * - hopId 为空且并非其它辅料（nonHop=false）的旧投加列入「待指认」，等人认到主档；
 * - 爱尔兰苔藓等非酒花辅料用 nonHop=true 表示，不参与 IBU；
 * - ibuSnapshot 为按主档 α 酸算出的苦度快照，主档 α 酸一改即 ibuStale 待重算。
 */
export interface BoilAdd {
  id: string;
  /** 所属配方 */
  recipeId: string;
  /** 投加时点（煮沸剩余分钟） */
  atMin: number;
  /** 物料名称（投花为主档名快照；非酒花辅料为自定义名） */
  material: string;
  /** 用量 g */
  amountG: number;
  /** 用途 */
  purpose: BoilPurpose;
  /** 酒花主档 id；null 表示尚未认到主档（待指认）或本身是非酒花辅料 */
  hopId: string | null;
  /** 是否为非酒花辅料（澄清剂等，不估算 IBU） */
  nonHop: boolean;
  /** α 酸快照 %（认主档当时的主档 α 酸） */
  alphaSnapshot: number;
  /** 苦度快照 IBU */
  ibuSnapshot: number;
  /** 苦度是否已作废待重算（主档 α 酸改过） */
  ibuStale: boolean;
}

export const BOIL_PURPOSES: BoilPurpose[] = ['苦味', '风味', '香气', '澄清'];
/** 煮沸总时长 min */
export const BOIL_TOTAL_MIN = 60;

export function createEmptyBoilAdd(): Omit<BoilAdd, 'id'> {
  return {
    recipeId: '',
    atMin: 60,
    material: '',
    amountG: 20,
    purpose: '苦味',
    hopId: null,
    nonHop: false,
    alphaSnapshot: 0,
    ibuSnapshot: 0,
    ibuStale: false
  };
}

/** 尚未认到酒花主档、又不是非酒花辅料的投加（需要人工指认） */
export function isUnresolvedBoilAdd(add: Pick<BoilAdd, 'hopId' | 'nonHop'>): boolean {
  return add.hopId === null && !add.nonHop;
}
