/** 煮沸投加 feature 的 NgRx actions */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { FilterModel } from '../../models/filter.model';
import type { BoilAdd } from '../../models/boil-add.model';
import type { BoilAddRow } from '../../utils/db';

export const BoilActions = createActionGroup({
  source: 'Boil',
  events: {
    'Load Boil Adds': emptyProps(),
    'Load Boil Adds Success': props<{ adds: BoilAddRow[] }>(),
    'Set Filter': props<{ filter: FilterModel }>(),
    'Reset Filter': emptyProps(),
    'Create Boil Add': props<{ payload: Omit<BoilAdd, 'id'> }>(),
    'Update Boil Add': props<{ id: string; patch: Partial<BoilAdd> }>(),
    'Delete Boil Add': props<{ id: string }>(),
    /** 把按名字认不出主档的投花人工指认到酒花主档 */
    'Link Boil Add Hop': props<{ id: string; hopId: string }>(),
    /** 该行苦度已按主档新 α 酸重算确认 */
    'Mark Boil Add Fresh': props<{ id: string }>()
  }
});
