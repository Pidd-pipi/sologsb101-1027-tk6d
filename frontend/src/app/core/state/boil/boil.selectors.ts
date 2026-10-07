/**
 * 煮沸投加 feature selectors
 * 投花认酒花主档 hopId：unresolved = 非澄清辅料但 hopId 为空（旧数据没认到，等人指认）。
 */
import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { HopCatalogRow } from '../../utils/db';
import type { BoilPurpose } from '../../models/boil-add.model';
import { selectAllHopCatalog } from '../ingredients/ingredients.selectors';
import { BoilState } from './boil.reducer';

export const selectBoilState = createFeatureSelector<BoilState>('boil');

export const selectAllBoilAdds = createSelector(selectBoilState, (state) => state.adds);
export const selectBoilFilter = createSelector(selectBoilState, (state) => state.filter);

/** 投加 join 酒花主档后的解析行 */
export interface ResolvedBoilAdd {
  id: string;
  recipeId: string;
  atMin: number;
  material: string;
  amountG: number;
  purpose: BoilPurpose;
  hopId: string | null;
  stale: boolean;
  hop: HopCatalogRow | null;
  /** 非澄清且 hopId 为空：按名字没认到主档，等人指认 */
  unresolved: boolean;
  /** hopId 有值但主档已删除 */
  missing: boolean;
}

export const selectResolvedBoilAdds = createSelector(
  selectAllBoilAdds,
  selectAllHopCatalog,
  (adds, hops): ResolvedBoilAdd[] => {
    const byId = new Map(hops.map((hop) => [hop.id, hop]));
    return adds.map((add) => {
      const hop = add.hopId ? (byId.get(add.hopId) ?? null) : null;
      const unresolved = add.purpose !== '澄清' && add.hopId === null;
      return {
        id: add.id,
        recipeId: add.recipeId,
        atMin: add.atMin,
        material: add.material,
        amountG: add.amountG,
        purpose: add.purpose,
        hopId: add.hopId,
        stale: add.stale === true,
        hop,
        unresolved,
        missing: add.hopId !== null && !hop
      };
    });
  }
);

/** 全库待人工指认的投花（旧数据按名字认不出主档的行） */
export const selectUnresolvedBoilAdds = createSelector(selectResolvedBoilAdds, (adds) =>
  adds.filter((add) => add.unresolved)
);

/** 按投加时点倒计时排序（atMin 大 → 小） */
export const selectBoilAddsByRecipe = (recipeId: string) =>
  createSelector(selectAllBoilAdds, selectBoilFilter, (adds, filter) => {
    const keyword = String(filter['keyword'] ?? '').trim().toLowerCase();
    const purposes = Array.isArray(filter['purposes']) ? (filter['purposes'] as string[]) : [];
    return adds
      .filter((add) => add.recipeId === recipeId)
      .filter((add) => {
        const label = `${add.material} ${add.purpose}`.toLowerCase();
        if (keyword && !label.includes(keyword)) return false;
        if (purposes.length > 0 && !purposes.includes(add.purpose)) return false;
        return true;
      })
      .sort((a, b) => b.atMin - a.atMin);
  });

/** 下一个投加点（时点最大且尚未到 0 的那一条） */
export const selectNextBoilAddByRecipe = (recipeId: string) =>
  createSelector(selectAllBoilAdds, (adds) => {
    const own = adds.filter((item) => item.recipeId === recipeId).sort((a, b) => b.atMin - a.atMin);
    return own.find((item) => item.atMin > 0) ?? null;
  });
