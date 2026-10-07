/** 辅料库 feature reducer：主档（色度 / α 酸出处）与配方用料（用量）分开存放 */
import { createReducer, on } from '@ngrx/store';
import type { FilterModel } from '../../models/filter.model';
import type { HopCatalogRow, HopUsageRow, MaltCatalogRow, RecipeMaltRow } from '../../utils/db';
import { IngredientsActions } from './ingredients.actions';

export interface IngredientsState {
  maltCatalog: MaltCatalogRow[];
  hopCatalog: HopCatalogRow[];
  recipeMalts: RecipeMaltRow[];
  hopUsages: HopUsageRow[];
  filter: FilterModel;
}

export const initialIngredientsState: IngredientsState = {
  maltCatalog: [],
  hopCatalog: [],
  recipeMalts: [],
  hopUsages: [],
  filter: { keyword: '', types: [], forms: [], origins: [] }
};

export const ingredientsReducer = createReducer(
  initialIngredientsState,
  on(
    IngredientsActions.loadIngredientsSuccess,
    (state, { maltCatalog, hopCatalog, recipeMalts, hopUsages }) => ({
      ...state,
      maltCatalog,
      hopCatalog,
      recipeMalts,
      hopUsages
    })
  ),
  on(IngredientsActions.setFilter, (state, { filter }) => ({ ...state, filter })),
  on(IngredientsActions.resetFilter, (state) => ({
    ...state,
    filter: { keyword: '', types: [], forms: [], origins: [] }
  }))
);
