/**
 * 配方 feature effects：把 NgRx actions 转成 Dexie 读写。
 * 所有变更动作完成后统一广播 Reload All，保证跨表数据一致；
 * 服务层拦截（如主档仍被引用）转 Mutation Rejected，由通知 effect 弹条提示。
 */
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import type { Action } from '@ngrx/store';
import { catchError, exhaustMap, forkJoin, from, map, of, switchMap } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RecipeService } from '../../services/recipe.service';
import { IngredientsActions } from '../ingredients/ingredients.actions';
import { MashActions } from '../mash/mash.actions';
import { BoilActions } from '../boil/boil.actions';
import { RecipeActions } from './recipe.actions';

@Injectable()
export class RecipeEffects {
  private readonly actions$ = inject(Actions);
  private readonly service = inject(RecipeService);
  private readonly snack = inject(MatSnackBar);

  /** 一次性加载配方主表 + 全部从属表 */
  reloadAll$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RecipeActions.reloadAll),
      switchMap(() =>
        forkJoin({
          recipes: from(this.service.listRecipes()),
          maltCatalog: from(this.service.listMaltCatalog()),
          hopCatalog: from(this.service.listHopCatalog()),
          recipeMalts: from(this.service.listRecipeMalts()),
          hopUsages: from(this.service.listHopUsages()),
          mashSteps: from(this.service.listMashSteps()),
          boilAdds: from(this.service.listBoilAdds())
        }).pipe(
          switchMap((data) => [
            RecipeActions.loadRecipesSuccess({ recipes: data.recipes }),
            IngredientsActions.loadIngredientsSuccess({
              maltCatalog: data.maltCatalog,
              hopCatalog: data.hopCatalog,
              recipeMalts: data.recipeMalts,
              hopUsages: data.hopUsages
            }),
            MashActions.loadMashStepsSuccess({ steps: data.mashSteps }),
            BoilActions.loadBoilAddsSuccess({ adds: data.boilAdds })
          ]),
          catchError((error: unknown) =>
            of(RecipeActions.loadFailure({ error: error instanceof Error ? error.message : '本地数据读取失败' }))
          )
        )
      )
    )
  );

  /** 变更被服务层拦下：弹条提示，不污染错误页 */
  rejected$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(RecipeActions.mutationRejected),
        switchMap(({ error }) => this.snack.open(error, '关闭', { duration: 3200 }).afterDismissed())
      ),
    { dispatch: false }
  );

  /** 配方增删改 */
  recipeMutation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RecipeActions.createRecipe, RecipeActions.updateRecipe, RecipeActions.deleteRecipe),
      exhaustMap((action) => {
        const task = (): Promise<unknown> => {
          switch (action.type) {
            case RecipeActions.createRecipe.type:
              return this.service.createRecipe(action.payload);
            case RecipeActions.updateRecipe.type:
              return this.service.updateRecipe(action.id, action.patch);
            default:
              return this.service.deleteRecipe((action as { id: string }).id);
          }
        };
        return from(task()).pipe(
          map(() => RecipeActions.reloadAll()),
          catchError((error: unknown) =>
            of(RecipeActions.mutationRejected({ error: error instanceof Error ? error.message : '保存失败' }))
          )
        );
      })
    )
  );

  /** 主档 / 配方用料 / 糖化步 / 煮沸投加的增删改与标脏处理 */
  ingredientMutation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        IngredientsActions.createMaltCatalog,
        IngredientsActions.updateMaltCatalog,
        IngredientsActions.deleteMaltCatalog,
        IngredientsActions.createRecipeMalt,
        IngredientsActions.updateRecipeMalt,
        IngredientsActions.deleteRecipeMalt,
        IngredientsActions.markRecipeMaltFresh,
        IngredientsActions.createHopCatalog,
        IngredientsActions.updateHopCatalog,
        IngredientsActions.deleteHopCatalog,
        IngredientsActions.createHopUsage,
        IngredientsActions.updateHopUsage,
        IngredientsActions.deleteHopUsage,
        IngredientsActions.markHopUsageFresh,
        MashActions.createMashStep,
        MashActions.updateMashStep,
        MashActions.deleteMashStep,
        MashActions.reorderMashSteps,
        BoilActions.createBoilAdd,
        BoilActions.updateBoilAdd,
        BoilActions.deleteBoilAdd,
        BoilActions.linkBoilAddHop,
        BoilActions.markBoilAddFresh
      ),
      exhaustMap((action) =>
        from(this.persistIngredient(action)).pipe(
          map(() => RecipeActions.reloadAll()),
          catchError((error: unknown) =>
            of(RecipeActions.mutationRejected({ error: error instanceof Error ? error.message : '保存失败' }))
          )
        )
      )
    )
  );

  private persistIngredient(action: Action): Promise<unknown> {
    const payload = action as unknown as Record<string, unknown>;
    switch (action.type) {
      case IngredientsActions.createMaltCatalog.type:
        return this.service.createMaltCatalog(payload['payload'] as never);
      case IngredientsActions.updateMaltCatalog.type:
        return this.service.updateMaltCatalog(payload['id'] as string, payload['patch'] as never);
      case IngredientsActions.deleteMaltCatalog.type:
        return this.service.deleteMaltCatalog(payload['id'] as string);
      case IngredientsActions.createRecipeMalt.type:
        return this.service.createRecipeMalt(payload['payload'] as never);
      case IngredientsActions.updateRecipeMalt.type:
        return this.service.updateRecipeMalt(payload['id'] as string, payload['patch'] as never);
      case IngredientsActions.deleteRecipeMalt.type:
        return this.service.deleteRecipeMalt(payload['id'] as string);
      case IngredientsActions.markRecipeMaltFresh.type:
        return this.service.markRecipeMaltFresh(payload['id'] as string);
      case IngredientsActions.createHopCatalog.type:
        return this.service.createHopCatalog(payload['payload'] as never);
      case IngredientsActions.updateHopCatalog.type:
        return this.service.updateHopCatalog(payload['id'] as string, payload['patch'] as never);
      case IngredientsActions.deleteHopCatalog.type:
        return this.service.deleteHopCatalog(payload['id'] as string);
      case IngredientsActions.createHopUsage.type:
        return this.service.createHopUsage(payload['payload'] as never);
      case IngredientsActions.updateHopUsage.type:
        return this.service.updateHopUsage(payload['id'] as string, payload['patch'] as never);
      case IngredientsActions.deleteHopUsage.type:
        return this.service.deleteHopUsage(payload['id'] as string);
      case IngredientsActions.markHopUsageFresh.type:
        return this.service.markHopUsageFresh(payload['id'] as string);
      case MashActions.createMashStep.type:
        return this.service.createMashStep(payload['payload'] as never);
      case MashActions.updateMashStep.type:
        return this.service.updateMashStep(payload['id'] as string, payload['patch'] as never);
      case MashActions.deleteMashStep.type:
        return this.service.deleteMashStep(payload['id'] as string);
      case MashActions.reorderMashSteps.type:
        return this.service.reorderMashSteps(payload['orderedIds'] as string[]);
      case BoilActions.createBoilAdd.type:
        return this.service.createBoilAdd(payload['payload'] as never);
      case BoilActions.updateBoilAdd.type:
        return this.service.updateBoilAdd(payload['id'] as string, payload['patch'] as never);
      case BoilActions.linkBoilAddHop.type:
        return this.service.linkBoilAddHop(payload['id'] as string, payload['hopId'] as string);
      case BoilActions.markBoilAddFresh.type:
        return this.service.markBoilAddFresh(payload['id'] as string);
      default:
        return this.service.deleteBoilAdd(payload['id'] as string);
    }
  }
}
