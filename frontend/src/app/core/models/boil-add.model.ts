/** 投加用途 */
export type BoilPurpose = '苦味' | '风味' | '香气' | '澄清';

/**
 * 煮沸投加：按倒计时排序生成投花时间表。
 * 酒花投加认酒花主档（hopId），不再照 material 名字认 α 酸；
 * hopId 为 null 表示非酒花辅料（如爱尔兰苔藓）或旧数据按名字没认到主档、留待人指认。
 */
export interface BoilAdd {
  id: string;
  /** 所属配方 */
  recipeId: string;
  /** 投加时点（煮沸剩余分钟） */
  atMin: number;
  /** 物料名称（非酒花辅料直接填写；酒花为主档名称快照） */
  material: string;
  /** 酒花主档 id：认到主档的酒花投加有值；非酒花辅料或认不出时为 null */
  hopId: string | null;
  /** 用量 g */
  amountG: number;
  /** 用途 */
  purpose: BoilPurpose;
  /** 主档 α 酸改动后尚未按新值重算：true 时该行苦度作废，待页面确认重算 */
  stale?: boolean;
}

export const BOIL_PURPOSES: BoilPurpose[] = ['苦味', '风味', '香气', '澄清'];
/** 煮沸总时长 min */
export const BOIL_TOTAL_MIN = 60;

export function createEmptyBoilAdd(): Omit<BoilAdd, 'id'> {
  return { recipeId: '', atMin: 60, material: '', hopId: null, amountG: 20, purpose: '苦味', stale: false };
}
