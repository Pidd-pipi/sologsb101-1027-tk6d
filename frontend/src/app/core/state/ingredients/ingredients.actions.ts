/** 麦芽 / 酒花主档与配方麦芽投料 feature 的 NgRx actions */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { FilterModel } from '../../models/filter.model';
import type { Malt } from '../../models/malt.model';
import type { Hop } from '../../models/hop.model';
import type { RecipeMalt } from '../../models/recipe-malt.model';
import type { HopRow, MaltRow, RecipeMaltRow } from '../../utils/db';

export const IngredientsActions = createActionGroup({
  source: 'Ingredients',
  events: {
    'Load Ingredients': emptyProps(),
    'Load Ingredients Success': props<{ malts: MaltRow[]; hops: HopRow[]; recipeMalts: RecipeMaltRow[] }>(),
    'Set Filter': props<{ filter: FilterModel }>(),
    'Reset Filter': emptyProps(),
    'Create Malt': props<{ payload: Omit<Malt, 'id'> }>(),
    'Update Malt': props<{ id: string; patch: Partial<Malt> }>(),
    'Delete Malt': props<{ id: string }>(),
    'Create Hop': props<{ payload: Omit<Hop, 'id'> }>(),
    'Update Hop': props<{ id: string; patch: Partial<Hop> }>(),
    'Delete Hop': props<{ id: string }>(),
    'Create Recipe Malt': props<{ payload: Omit<RecipeMalt, 'id'> }>(),
    'Update Recipe Malt': props<{ id: string; patch: Partial<RecipeMalt> }>(),
    'Delete Recipe Malt': props<{ id: string }>(),
    /** 重算一个/多个配方的色度缓存（用户确认） */
    'Recompute Ebc': props<{ recipeIds?: string[] }>()
  }
});
