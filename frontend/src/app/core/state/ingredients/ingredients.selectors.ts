/** 辅料库 feature selectors */
import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { BoilAddRow } from '../../utils/db';
import { IngredientsState } from './ingredients.reducer';export const selectIngredientsState = createFeatureSelector<IngredientsState>('ingredients');

export const selectAllMalts = createSelector(selectIngredientsState, (state) => state.malts);
export const selectAllHops = createSelector(selectIngredientsState, (state) => state.hops);
export const selectAllRecipeMalts = createSelector(selectIngredientsState, (state) => state.recipeMalts);
export const selectIngredientsFilter = createSelector(selectIngredientsState, (state) => state.filter);

export const selectFilteredMalts = createSelector(selectAllMalts, selectIngredientsFilter, (malts, filter) => {
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

export const selectFilteredHops = createSelector(selectAllHops, selectIngredientsFilter, (hops, filter) => {
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

/** 指定配方的麦芽投料行 */
export const selectRecipeMaltsByRecipe = (recipeId: string) =>
  createSelector(selectAllRecipeMalts, (refs) => refs.filter((item) => item.recipeId === recipeId));

/** 色度缓存已作废待重算的配方 id 集合（任一投料主档色度改过） */
export const selectStaleEbcRecipeIds = createSelector(
  selectAllRecipeMalts,
  (refs) => new Set(refs.filter((item) => item.ebcStale).map((item) => item.recipeId))
);

/** 被煮沸投花引用的酒花主档 id 集合（由煮沸页数据聚合，供辅料库删除拦截预检） */
export const selectReferencedHopIds = (adds: BoilAddRow[]) =>
  new Set(adds.filter((add) => add.hopId !== null).map((add) => add.hopId as string));
