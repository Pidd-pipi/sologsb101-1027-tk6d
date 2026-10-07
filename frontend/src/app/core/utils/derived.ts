/**
 * 派生结果重算：色度（配方加权 EBC / 色度偏差）与煮沸苦度（IBU 快照）。
 *
 * 约定：麦芽 / 酒花主档是色度与 α 酸的唯一出处。引用方只保存快照，
 * 主档相关值一改动，引用方快照先作废（stale）并在页面标出，由这里的
 * 重算函数在用户确认后刷新。纯函数版本（snapshot*）供 Dexie 结构迁移复用。
 */
import type { BoilAdd, BoilPurpose } from '../models/boil-add.model';
import type { Hop } from '../models/hop.model';
import type { Recipe } from '../models/recipe.model';
import type { RecipeMalt } from '../models/recipe-malt.model';
import { estimateIbu } from './brew';

/** 加权平均色度所需的最小引用结构 */
export interface EbcRef {
  ebcSnapshot: number;
  ratioPct: number;
}

/** 由引用行的色度快照计算配方加权平均色度 EBC */
export function weightedEbcFromRefs(refs: EbcRef[]): number {
  const totalRatio = refs.reduce((sum, item) => sum + item.ratioPct, 0);
  if (totalRatio === 0) return 0;
  const weighted = refs.reduce((sum, item) => sum + item.ebcSnapshot * item.ratioPct, 0) / totalRatio;
  return Number(weighted.toFixed(1));
}

/** 色度偏差（缓存色度 - 目标） */
export function ebcDeltaOf(recipe: Pick<Recipe, 'ebcSnapshot' | 'targetEbc'>): number {
  return Number((recipe.ebcSnapshot - recipe.targetEbc).toFixed(1));
}

/** 煮沸苦度计算所需的上下文 */
export interface IbuContext {
  batchSizeL: number;
  targetOg: number;
}

/** 单条投加在给定 α 酸下的 IBU */
export function boilAddIbu(
  alphaPct: number,
  add: Pick<BoilAdd, 'amountG' | 'atMin'>,
  context: IbuContext
): number {
  return estimateIbu(alphaPct, add.amountG, add.atMin, context.batchSizeL, context.targetOg);
}

/**
 * 迁移（v1 → v2）用的纯数据结构，不依赖 Dexie 行类型。
 * 旧的煮沸投加照 material 名字认酒花主档；认不出的留待人工指认。
 */
export interface V1BoilAddish {
  id?: string;
  recipeId?: string;
  atMin?: number;
  material?: string;
  amountG?: number;
  purpose?: BoilPurpose;
}

export interface V1Recipeish {
  id?: string;
  batchSizeL?: number;
  targetOg?: number;
}

/**
 * 为一条旧投加按名字匹配酒花主档并生成苦度快照。
 * @returns 煮沸投加的新增字段（hopId / nonHop / alphaSnapshot / ibuSnapshot / ibuStale / material）
 */
export function resolveV1BoilAdd(
  add: V1BoilAddish,
  hopsByName: Map<string, Hop>,
  recipe?: V1Recipeish
): Pick<BoilAdd, 'hopId' | 'nonHop' | 'alphaSnapshot' | 'ibuSnapshot' | 'ibuStale' | 'material'> {
  const material = String(add.material ?? '').trim();
  // 澄清用途且名字认不到主档：按非酒花辅料处理，不进待指认、不计 IBU
  const matched = material ? hopsByName.get(material) : undefined;
  if (matched) {
    const context = { batchSizeL: recipe?.batchSizeL ?? 20, targetOg: recipe?.targetOg ?? 1.055 };
    return {
      hopId: matched.id,
      nonHop: false,
      alphaSnapshot: matched.alphaPct,
      ibuSnapshot: boilAddIbu(matched.alphaPct, { amountG: add.amountG ?? 0, atMin: add.atMin ?? 0 }, context),
      ibuStale: false,
      material: matched.name
    };
  }
  const nonHop = add.purpose === '澄清';
  return { hopId: null, nonHop, alphaSnapshot: 0, ibuSnapshot: 0, ibuStale: false, material };
}
