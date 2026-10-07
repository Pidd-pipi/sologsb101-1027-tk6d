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
    /** 待指认投花认到酒花主档 */
    'Resolve Boil Hop': props<{ addId: string; hopId: string }>(),
    /** 待指认项确认为非酒花辅料 */
    'Mark Boil Non Hop': props<{ addId: string }>(),
    /** 重算一条/多条投花的苦度快照（用户确认） */
    'Recompute Ibu': props<{ addIds?: string[] }>()
  }
});
