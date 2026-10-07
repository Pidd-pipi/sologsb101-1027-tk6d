/** 辅料库 feature 的 NgRx actions：麦芽 / 酒花主档 + 配方用料四张表 */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { FilterModel } from '../../models/filter.model';
import type { MaltCatalog, RecipeMalt } from '../../models/malt.model';
import type { HopCatalog, HopUsage } from '../../models/hop.model';
import type { HopCatalogRow, HopUsageRow, MaltCatalogRow, RecipeMaltRow } from '../../utils/db';

export const IngredientsActions = createActionGroup({
  source: 'Ingredients',
  events: {
    'Load Ingredients': emptyProps(),
    'Load Ingredients Success': props<{
      maltCatalog: MaltCatalogRow[];
      hopCatalog: HopCatalogRow[];
      recipeMalts: RecipeMaltRow[];
      hopUsages: HopUsageRow[];
    }>(),
    'Set Filter': props<{ filter: FilterModel }>(),
    'Reset Filter': emptyProps(),

    // 麦芽主档 / 配方麦芽
    'Create Malt Catalog': props<{ payload: Omit<MaltCatalog, 'id'> }>(),
    'Update Malt Catalog': props<{ id: string; patch: Partial<MaltCatalog> }>(),
    'Delete Malt Catalog': props<{ id: string }>(),
    'Create Recipe Malt': props<{ payload: Omit<RecipeMalt, 'id'> }>(),
    'Update Recipe Malt': props<{ id: string; patch: Partial<RecipeMalt> }>(),
    'Delete Recipe Malt': props<{ id: string }>(),
    'Mark Recipe Malt Fresh': props<{ id: string }>(),

    // 酒花主档 / 配方酒花
    'Create Hop Catalog': props<{ payload: Omit<HopCatalog, 'id'> }>(),
    'Update Hop Catalog': props<{ id: string; patch: Partial<HopCatalog> }>(),
    'Delete Hop Catalog': props<{ id: string }>(),
    'Create Hop Usage': props<{ payload: Omit<HopUsage, 'id'> }>(),
    'Update Hop Usage': props<{ id: string; patch: Partial<HopUsage> }>(),
    'Delete Hop Usage': props<{ id: string }>(),
    'Mark Hop Usage Fresh': props<{ id: string }>()
  }
});
