/**
 * 辅料库 feature selectors
 * 配方用料行 join 主档后输出「解析行」：色度 / α 酸永远取主档现值；
 * 主档缺失或 stale=true 时，页面据此把旧偏差 / 旧苦度标成待重算。
 */
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { weightedEbc } from '../../utils/brew';
import { IngredientsState } from './ingredients.reducer';

export const selectIngredientsState = createFeatureSelector<IngredientsState>('ingredients');

export const selectAllMaltCatalog = createSelector(selectIngredientsState, (state) => state.maltCatalog);
export const selectAllHopCatalog = createSelector(selectIngredientsState, (state) => state.hopCatalog);
export const selectAllRecipeMalts = createSelector(selectIngredientsState, (state) => state.recipeMalts);
export const selectAllHopUsages = createSelector(selectIngredientsState, (state) => state.hopUsages);
export const selectIngredientsFilter = createSelector(selectIngredientsState, (state) => state.filter);

/** 麦芽主档按 id 索引 */
export const selectMaltCatalogById = createSelector(selectAllMaltCatalog, (rows) => {
  const map = new Map(rows.map((row) => [row.id, row]));
  return (id: string) => map.get(id) ?? null;
});

/** 酒花主档按 id 索引 */
export const selectHopCatalogById = createSelector(selectAllHopCatalog, (rows) => {
  const map = new Map(rows.map((row) => [row.id, row]));
  return (id: string | null) => (id ? (map.get(id) ?? null) : null);
});

/** 配方麦芽 join 主档后的解析行 */
export interface ResolvedRecipeMalt {
  id: string;
  recipeId: string;
  maltId: string;
  name: string;
  /** 色度取自主档；主档缺失时回退名称快照（视为待处理） */
  ebc: number | null;
  origin: string;
  type: string;
  ratioPct: number;
  stale: boolean;
  /** 主档已被删除 / 认不到 */
  missing: boolean;
}

/** 配方酒花 join 主档后的解析行 */
export interface ResolvedHopUsage {
  id: string;
  recipeId: string;
  hopId: string;
  name: string;
  alphaPct: number | null;
  origin: string;
  form: string;
  amountG: number;
  stale: boolean;
  missing: boolean;
}

export const selectResolvedRecipeMalts = createSelector(
  selectAllRecipeMalts,
  selectAllMaltCatalog,
  (rows, catalog): ResolvedRecipeMalt[] =>
    rows.map((row) => {
      const catalogRow = catalog.find((item) => item.id === row.maltId);
      return {
        id: row.id,
        recipeId: row.recipeId,
        maltId: row.maltId,
        name: catalogRow?.name ?? row.name,
        ebc: catalogRow?.ebc ?? null,
        origin: catalogRow?.origin ?? '',
        type: catalogRow?.type ?? '',
        ratioPct: row.ratioPct,
        stale: row.stale === true,
        missing: !catalogRow
      };
    })
);

export const selectResolvedHopUsages = createSelector(
  selectAllHopUsages,
  selectAllHopCatalog,
  (rows, catalog): ResolvedHopUsage[] =>
    rows.map((row) => {
      const catalogRow = catalog.find((item) => item.id === row.hopId);
      return {
        id: row.id,
        recipeId: row.recipeId,
        hopId: row.hopId,
        name: catalogRow?.name ?? row.name,
        alphaPct: catalogRow?.alphaPct ?? null,
        origin: catalogRow?.origin ?? '',
        form: catalogRow?.form ?? '',
        amountG: row.amountG,
        stale: row.stale === true,
        missing: !catalogRow
      };
    })
);

/* ------------------------------ 筛选 ------------------------------ */

export const selectFilteredMaltCatalog = createSelector(selectAllMaltCatalog, selectIngredientsFilter, (malts, filter) => {
  const keyword = String(filter['keyword'] ?? '').trim().toLowerCase();
  const types = Array.isArray(filter['types']) ? (filter['types'] as string[]) : [];
  const origins = Array.isArray(filter['origins']) ? (filter['origins'] as string[]) : [];
  return malts.filter((malt) => {
    const label = `${malt.name} ${malt.origin} ${malt.type}`.toLowerCase();
    if (keyword && !label.includes(keyword)) return false;
    if (types.length > 0 && !types.includes(malt.type)) return false;
    if (origins.length > 0 && !origins.includes(malt.origin)) return false;
    return true;
  });
});

export const selectFilteredHopCatalog = createSelector(selectAllHopCatalog, selectIngredientsFilter, (hops, filter) => {
  const keyword = String(filter['keyword'] ?? '').trim().toLowerCase();
  const forms = Array.isArray(filter['forms']) ? (filter['forms'] as string[]) : [];
  const origins = Array.isArray(filter['origins']) ? (filter['origins'] as string[]) : [];
  return hops.filter((hop) => {
    const label = `${hop.name} ${hop.origin} ${hop.form}`.toLowerCase();
    if (keyword && !label.includes(keyword)) return false;
    if (forms.length > 0 && !forms.includes(hop.form)) return false;
    if (origins.length > 0 && !origins.includes(hop.origin)) return false;
    return true;
  });
});

/** 当前配方下 join 主档并按关键字过滤的配方麦芽 */
export const selectResolvedRecipeMaltsByRecipe = (recipeId: string) =>
  createSelector(selectResolvedRecipeMalts, selectIngredientsFilter, (rows, filter) => {
    const keyword = String(filter['keyword'] ?? '').trim().toLowerCase();
    return rows
      .filter((row) => row.recipeId === recipeId)
      .filter((row) => !keyword || `${row.name} ${row.origin} ${row.type}`.toLowerCase().includes(keyword));
  });

/** 当前配方下 join 主档并按关键字过滤的配方酒花 */
export const selectResolvedHopUsagesByRecipe = (recipeId: string) =>
  createSelector(selectResolvedHopUsages, selectIngredientsFilter, (rows, filter) => {
    const keyword = String(filter['keyword'] ?? '').trim().toLowerCase();
    return rows
      .filter((row) => row.recipeId === recipeId)
      .filter((row) => !keyword || `${row.name} ${row.origin} ${row.form}`.toLowerCase().includes(keyword));
  });

/** 指定配方的加权平均色度（只计主档在线的麦芽） */
export const selectEbcByRecipe = (recipeId: string) =>
  createSelector(selectResolvedRecipeMalts, (rows) => {
    const own = rows.filter((item) => item.recipeId === recipeId && item.ebc !== null);
    return weightedEbc(own.map((item) => ({ ebc: item.ebc as number, ratioPct: item.ratioPct })));
  });

/** 指定配方的酒花投放量合计 */
export const selectHopAmountByRecipe = (recipeId: string) =>
  createSelector(selectAllHopUsages, (rows) =>
    rows.filter((item) => item.recipeId === recipeId).reduce((sum, item) => sum + item.amountG, 0)
  );

/** 指定配方是否存在「主档色度改动后尚未重算」的配方麦芽 */
export const selectRecipeMaltStaleByRecipe = (recipeId: string) =>
  createSelector(
    selectAllRecipeMalts,
    (rows) => rows.some((item) => item.recipeId === recipeId && item.stale === true)
  );

/** 指定配方是否存在「主档 α 酸改动后尚未重算」的配方酒花 */
export const selectHopUsageStaleByRecipe = (recipeId: string) =>
  createSelector(selectAllHopUsages, (rows) => rows.some((item) => item.recipeId === recipeId && item.stale === true));
