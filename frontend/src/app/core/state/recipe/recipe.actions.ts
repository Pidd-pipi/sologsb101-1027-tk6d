/** 配方 feature 的 NgRx actions */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { Recipe } from '../../models/recipe.model';
import type { FilterModel } from '../../models/filter.model';
import type { RecipeRow } from '../../utils/db';

export const RecipeActions = createActionGroup({
  source: 'Recipe',
  events: {
    'Load Recipes': emptyProps(),
    'Load Recipes Success': props<{ recipes: RecipeRow[] }>(),
    'Load Failure': props<{ error: string }>(),
    'Reload All': emptyProps(),
    'Select Recipe': props<{ id: string | null }>(),
    'Set Filter': props<{ filter: FilterModel }>(),
    'Reset Filter': emptyProps(),
    /** 增删改被服务层拦下（如主档仍被引用）：统一弹条提示，不落错误页 */
    'Mutation Rejected': props<{ error: string }>(),
    'Create Recipe': props<{ payload: Omit<Recipe, 'id'> }>(),
    'Update Recipe': props<{ id: string; patch: Partial<Recipe> }>(),
    'Delete Recipe': props<{ id: string }>()
  }
});
