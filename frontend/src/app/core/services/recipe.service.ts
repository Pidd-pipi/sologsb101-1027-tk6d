/**
 * RecipeService：配方及辅料主档 / 引用数据（配方麦芽投料 / 酒花 / 糖化步 / 煮沸投加 / 发酵 / 罐装）的读写收口。
 * 全部读写走 IdbTableService → Dexie → IndexedDB。
 *
 * 关键规则：
 * - 麦芽 / 酒花主档是色度与 α 酸的唯一出处；主档相关值一改，引用方快照立即作废（stale），不自动重算；
 * - 投花认酒花主档 id，指认 / 解绑在此落库；
 * - 删除主档前校验引用：仍被配方麦芽投料或投花引用则抛错拦住。
 */
import { Injectable, inject } from '@angular/core';
import type { Recipe } from '../models/recipe.model';
import type { Malt } from '../models/malt.model';
import type { Hop } from '../models/hop.model';
import type { RecipeMalt } from '../models/recipe-malt.model';
import type { MashStep } from '../models/mash-step.model';
import type { BoilAdd } from '../models/boil-add.model';
import type { Ferment } from '../models/ferment.model';
import type { Packaging } from '../models/packaging.model';
import {
  db,
  removeRecipe,
  ROW_REVISION,
  type BoilAddRow,
  type FermentRow,
  type HopRow,
  type MaltRow,
  type MashStepRow,
  type PackagingRow,
  type RecipeMaltRow,
  type RecipeRow
} from '../utils/db';
import { createId } from '../utils/uuid';
import { IdbTableService } from './idb-table.service';
import { boilAddIbu, weightedEbcFromRefs } from '../utils/derived';

/** 删除主档时发现仍被引用 */
export class IngredientInUseError extends Error {
  constructor(
    public readonly kind: 'malt' | 'hop',
    public readonly refs: number
  ) {
    super(kind === 'malt' ? `该麦芽仍被 ${refs} 条配方投料引用，不能删除` : `该酒花仍被 ${refs} 条煮沸投花引用，不能删除`);
    this.name = 'IngredientInUseError';
  }
}

@Injectable({ providedIn: 'root' })
export class RecipeService {
  private readonly idb = inject(IdbTableService);

  /* ------------------------------ 配方 ------------------------------ */

  listRecipes(): Promise<RecipeRow[]> {
    return db.recipes.toArray().then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')));
  }

  async createRecipe(payload: Omit<Recipe, 'id'>): Promise<string> {
    const row = this.idb.buildRow({ ...payload, ebcSnapshot: 0, ebcStale: false }, 'recipe') as RecipeRow;
    await db.recipes.put(row);
    return row.id;
  }

  /** 配方目标变化时同步重算色度偏差缓存；快照字段不允许由表单直接覆盖 */
  async updateRecipe(id: string, patch: Partial<Recipe>): Promise<void> {
    const { ebcSnapshot: _omitSnapshot, ebcStale: _omitStale, ...targets } = patch;
    await this.idb.update(db.recipes, id, targets);
    await this.recomputeRecipeEbc([id]);
  }

  deleteRecipe(id: string): Promise<void> {
    return removeRecipe(id);
  }

  /* ---------------------------- 麦芽主档 ---------------------------- */

  listMalts(): Promise<MaltRow[]> {
    return db.malts.toArray();
  }

  async createMalt(payload: Omit<Malt, 'id'>): Promise<string> {
    const row = { ...payload, id: createId('malt'), revision: ROW_REVISION, createdAt: Date.now(), updatedAt: Date.now() };
    await db.malts.put(row);
    return row.id;
  }

  /** 色度（或其它字段）一改，所有引用该主档的配方投料与配方色度缓存立即作废 */
  async updateMalt(id: string, patch: Partial<Malt>): Promise<void> {
    await db.transaction('rw', [db.malts, db.recipeMalts, db.recipes], async () => {
      await this.idb.update(db.malts, id, patch);
      if (typeof patch.ebc === 'number') {
        const refs = await db.recipeMalts.where('maltId').equals(id).toArray();
        const recipeIds = new Set(refs.map((ref) => ref.recipeId));
        for (const ref of refs) {
          await db.recipeMalts.update(ref.id, { ebcStale: true, updatedAt: Date.now() } as never);
        }
        for (const recipeId of recipeIds) {
          await db.recipes.update(recipeId, { ebcStale: true, updatedAt: Date.now() } as never);
        }
      }
    });
  }

  /** 删除前拦截：仍被配方投料引用则抛错 */
  async deleteMalt(id: string): Promise<void> {
    const refCount = await db.recipeMalts.where('maltId').equals(id).count();
    if (refCount > 0) throw new IngredientInUseError('malt', refCount);
    await this.idb.remove(db.malts, id);
  }

  /* -------------------------- 配方麦芽投料 -------------------------- */

  listRecipeMalts(): Promise<RecipeMaltRow[]> {
    return db.recipeMalts.toArray();
  }

  /** 新增投料：从主档取色度快照，并重算所属配方色度 */
  async createRecipeMalt(payload: Omit<RecipeMalt, 'id'>): Promise<string> {
    const master = await db.malts.get(payload.maltId);
    const row: RecipeMaltRow = {
      ...payload,
      nameSnapshot: master?.name ?? payload.nameSnapshot,
      ebcSnapshot: master?.ebc ?? payload.ebcSnapshot,
      ebcStale: false,
      id: createId('rm'),
      revision: ROW_REVISION,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await db.recipeMalts.put(row);
    await this.recomputeRecipeEbc([payload.recipeId]);
    return row.id;
  }

  /** 改配比 / 换主档：换主档取新快照，随后重算配方色度 */
  async updateRecipeMalt(id: string, patch: Partial<RecipeMalt>): Promise<void> {
    await db.transaction('rw', [db.recipeMalts, db.malts, db.recipes], async () => {
      const existing = await db.recipeMalts.get(id);
      let recipeId = existing?.recipeId;
      if (patch.maltId) {
        const master = await db.malts.get(patch.maltId);
        await db.recipeMalts.update(id, {
          ...patch,
          nameSnapshot: master?.name ?? existing?.nameSnapshot ?? '',
          ebcSnapshot: master?.ebc ?? existing?.ebcSnapshot ?? 0,
          ebcStale: false,
          updatedAt: Date.now()
        } as never);
      } else {
        await this.idb.update(db.recipeMalts, id, patch);
      }
      recipeId = patch.recipeId ?? recipeId;
      if (recipeId) await this.recomputeRecipeEbc([recipeId]);
    });
  }

  async deleteRecipeMalt(id: string): Promise<void> {
    const existing = await db.recipeMalts.get(id);
    await this.idb.remove(db.recipeMalts, id);
    if (existing) await this.recomputeRecipeEbc([existing.recipeId]);
  }

  /* ---------------------------- 酒花主档 ---------------------------- */

  listHops(): Promise<HopRow[]> {
    return db.hops.toArray();
  }

  async createHop(payload: Omit<Hop, 'id'>): Promise<string> {
    const row = { ...payload, id: createId('hop'), revision: ROW_REVISION, createdAt: Date.now(), updatedAt: Date.now() };
    await db.hops.put(row);
    return row.id;
  }

  /** α 酸（或其它字段）一改，所有投花的苦度快照立即作废 */
  async updateHop(id: string, patch: Partial<Hop>): Promise<void> {
    await db.transaction('rw', [db.hops, db.boilAdds], async () => {
      await this.idb.update(db.hops, id, patch);
      if (typeof patch.alphaPct === 'number') {
        const adds = await db.boilAdds.where('hopId').equals(id).toArray();
        for (const add of adds) {
          await db.boilAdds.update(add.id, { ibuStale: true, updatedAt: Date.now() } as never);
        }
      }
    });
  }

  /** 删除前拦截：仍被煮沸投花引用则抛错 */
  async deleteHop(id: string): Promise<void> {
    const refCount = await db.boilAdds.where('hopId').equals(id).count();
    if (refCount > 0) throw new IngredientInUseError('hop', refCount);
    await this.idb.remove(db.hops, id);
  }

  /* ---------------------------- 煮沸投加 ---------------------------- */

  listBoilAdds(): Promise<BoilAddRow[]> {
    return db.boilAdds.toArray();
  }

  /** 新增投加：酒花取主档 α 酸并现算 IBU；非酒花辅料不计苦度 */
  async createBoilAdd(payload: Omit<BoilAdd, 'id'>): Promise<string> {
    const resolved = payload.nonHop || !payload.hopId ? payload : await this.withHopSnapshot(payload);
    const row = {
      ...resolved,
      id: createId('boil'),
      revision: ROW_REVISION,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await db.boilAdds.put(row);
    return row.id;
  }

  /** 编辑投加：换了主档 / 时点 / 用量就现算苦度 */
  async updateBoilAdd(id: string, patch: Partial<BoilAdd>): Promise<void> {
    const existing = await db.boilAdds.get(id);
    let next: Partial<BoilAdd> = { ...patch };
    if (existing && !next.nonHop && next.hopId) {
      const merged = { ...existing, ...next } as BoilAdd;
      const hop = await db.hops.get(next.hopId);
      if (hop) {
        const recipe = await db.recipes.get(merged.recipeId);
        next = {
          ...next,
          material: hop.name,
          alphaSnapshot: hop.alphaPct,
          ibuSnapshot: boilAddIbu(
            hop.alphaPct,
            { amountG: merged.amountG, atMin: merged.atMin },
            { batchSizeL: recipe?.batchSizeL ?? 20, targetOg: recipe?.targetOg ?? 1.055 }
          ),
          ibuStale: false
        };
      }
    } else if (existing && next.nonHop) {
      next = { ...next, hopId: null, alphaSnapshot: 0, ibuSnapshot: 0, ibuStale: false };
    }
    await this.idb.update(db.boilAdds, id, next);
  }

  deleteBoilAdd(id: string): Promise<void> {
    return this.idb.remove(db.boilAdds, id);
  }

  /** 待指认投花认到酒花主档：写 hopId / α 酸快照并现算 IBU */
  async resolveBoilAddHop(addId: string, hopId: string): Promise<void> {
    await db.transaction('rw', [db.boilAdds, db.hops, db.recipes], async () => {
      const add = await db.boilAdds.get(addId);
      const hop = await db.hops.get(hopId);
      if (!add || !hop) return;
      const recipe = await db.recipes.get(add.recipeId);
      await db.boilAdds.update(addId, {
        hopId: hop.id,
        nonHop: false,
        material: hop.name,
        alphaSnapshot: hop.alphaPct,
        ibuSnapshot: boilAddIbu(
          hop.alphaPct,
          { amountG: add.amountG, atMin: add.atMin },
          { batchSizeL: recipe?.batchSizeL ?? 20, targetOg: recipe?.targetOg ?? 1.055 }
        ),
        ibuStale: false,
        updatedAt: Date.now()
      } as never);
    });
  }

  /** 待指认项确认为非酒花辅料（如澄清剂）：不参与 IBU，退出待指认 */
  async markBoilAddNonHop(addId: string): Promise<void> {
    await this.idb.update(db.boilAdds, addId, {
      hopId: null,
      nonHop: true,
      alphaSnapshot: 0,
      ibuSnapshot: 0,
      ibuStale: false
    });
  }

  /* --------------------------- 快照重算入口 --------------------------- */

  /** 重算指定配方的加权色度缓存（用户确认后调用，旧值就此作数刷新） */
  async recomputeRecipeEbc(recipeIds?: string[]): Promise<number> {
    return db.transaction('rw', [db.recipes, db.recipeMalts, db.malts], async () => {
      const allRefs = await db.recipeMalts.toArray();
      const ids = recipeIds ? new Set(recipeIds) : null;
      const refsByRecipe = new Map<string, RecipeMaltRow[]>();
      for (const ref of allRefs) {
        if (ids && !ids.has(ref.recipeId)) continue;
        const list = refsByRecipe.get(ref.recipeId) ?? [];
        list.push(ref);
        refsByRecipe.set(ref.recipeId, list);
      }
      const malts = await db.malts.toArray();
      const maltById = new Map(malts.map((item) => [item.id, item]));

      // 无投料行的配方（如刚删完最后一条）色度缓存归零
      const recipesToZero = await db.recipes
        .filter((recipe) => !refsByRecipe.has(recipe.id) && (!ids || ids.has(recipe.id)))
        .toArray();
      for (const recipe of recipesToZero) {
        if (recipe.ebcSnapshot !== 0 || recipe.ebcStale) {
          await db.recipes.update(recipe.id, { ebcSnapshot: 0, ebcStale: false, updatedAt: Date.now() } as never);
        }
      }

      let count = 0;
      for (const [recipeId, refs] of refsByRecipe) {
        for (const ref of refs) {
          const master = maltById.get(ref.maltId);
          if (master && (ref.ebcStale || ref.ebcSnapshot !== master.ebc || ref.nameSnapshot !== master.name)) {
            await db.recipeMalts.update(ref.id, {
              nameSnapshot: master.name,
              ebcSnapshot: master.ebc,
              ebcStale: false,
              updatedAt: Date.now()
            } as never);
            ref.nameSnapshot = master.name;
            ref.ebcSnapshot = master.ebc;
            ref.ebcStale = false;
          }
        }
        const stillStale = refs.some((ref) => ref.ebcStale);
        await db.recipes.update(recipeId, {
          ebcSnapshot: weightedEbcFromRefs(refs.map((ref) => ({ ebcSnapshot: ref.ebcSnapshot, ratioPct: ref.ratioPct }))),
          ebcStale: stillStale,
          updatedAt: Date.now()
        } as never);
        count += 1;
      }
      return count;
    });
  }

  /** 重算指定投花的苦度快照（用户确认后调用） */
  async recomputeBoilAddIbu(addIds?: string[]): Promise<number> {
    return db.transaction('rw', [db.boilAdds, db.hops, db.recipes], async () => {
      const adds = await db.boilAdds.toArray();
      const targets = addIds ? adds.filter((add) => addIds.includes(add.id)) : adds;
      const hops = await db.hops.toArray();
      const hopById = new Map(hops.map((item) => [item.id, item]));
      const recipes = await db.recipes.toArray();
      const recipeById = new Map(recipes.map((item) => [item.id, item]));
      let count = 0;
      for (const add of targets) {
        if (add.nonHop) continue;
        const hop = add.hopId ? hopById.get(add.hopId) : undefined;
        if (!hop) continue;
        const recipe = recipeById.get(add.recipeId);
        await db.boilAdds.update(add.id, {
          material: hop.name,
          alphaSnapshot: hop.alphaPct,
          ibuSnapshot: boilAddIbu(
            hop.alphaPct,
            { amountG: add.amountG, atMin: add.atMin },
            { batchSizeL: recipe?.batchSizeL ?? 20, targetOg: recipe?.targetOg ?? 1.055 }
          ),
          ibuStale: false,
          updatedAt: Date.now()
        } as never);
        count += 1;
      }
      return count;
    });
  }

  /* ----------------------------- 糖化步 ----------------------------- */

  listMashSteps(): Promise<MashStepRow[]> {
    return db.mashSteps.toArray().then((rows) => rows.sort((a, b) => a.seq - b.seq));
  }

  async createMashStep(payload: Omit<MashStep, 'id' | 'seq'>): Promise<string> {
    const existing = await db.mashSteps.where('recipeId').equals(payload.recipeId).toArray();
    const seq = existing.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
    const row = {
      ...payload,
      seq,
      id: createId('mash'),
      revision: ROW_REVISION,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await db.mashSteps.put(row);
    return row.id;
  }

  updateMashStep(id: string, patch: Partial<MashStep>): Promise<void> {
    return this.idb.update(db.mashSteps, id, patch);
  }

  deleteMashStep(id: string): Promise<void> {
    return this.idb.remove(db.mashSteps, id);
  }

  /** 拖拽调序后按新顺序批量写回 seq */
  async reorderMashSteps(orderedIds: string[]): Promise<void> {
    await db.transaction('rw', [db.mashSteps], async () => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await db.mashSteps.update(orderedIds[index], { seq: index + 1, updatedAt: Date.now() } as never);
      }
    });
  }

  /* ---------------------------- 发酵读数 ---------------------------- */

  listFerments(): Promise<FermentRow[]> {
    return db.ferments.toArray().then((rows) => rows.sort((a, b) => a.date.localeCompare(b.date)));
  }

  async createFerment(payload: Omit<Ferment, 'id'>): Promise<string> {
    const row = {
      ...payload,
      id: createId('ferment'),
      revision: ROW_REVISION,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await db.ferments.put(row);
    return row.id;
  }

  updateFerment(id: string, patch: Partial<Ferment>): Promise<void> {
    return this.idb.update(db.ferments, id, patch);
  }

  deleteFerment(id: string): Promise<void> {
    return this.idb.remove(db.ferments, id);
  }

  /* ---------------------------- 罐装批次 ---------------------------- */

  listPackagings(): Promise<PackagingRow[]> {
    return db.packagings.toArray().then((rows) => rows.sort((a, b) => b.packDate.localeCompare(a.packDate)));
  }

  async createPackaging(payload: Omit<Packaging, 'id'>): Promise<string> {
    const row = {
      ...payload,
      id: createId('packaging'),
      revision: ROW_REVISION,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await db.packagings.put(row);
    return row.id;
  }

  updatePackaging(id: string, patch: Partial<Packaging>): Promise<void> {
    return this.idb.update(db.packagings, id, patch);
  }

  deletePackaging(id: string): Promise<void> {
    return this.idb.remove(db.packagings, id);
  }

  /* ------------------------------ 私有 ------------------------------ */

  /** 新投加是酒花时补齐 α 酸 / IBU 快照 */
  private async withHopSnapshot(payload: Omit<BoilAdd, 'id'>): Promise<Omit<BoilAdd, 'id'>> {
    const hop = payload.hopId ? await db.hops.get(payload.hopId) : undefined;
    if (!hop) return payload;
    const recipe = await db.recipes.get(payload.recipeId);
    return {
      ...payload,
      material: hop.name,
      alphaSnapshot: hop.alphaPct,
      ibuSnapshot: boilAddIbu(
        hop.alphaPct,
        { amountG: payload.amountG, atMin: payload.atMin },
        { batchSizeL: recipe?.batchSizeL ?? 20, targetOg: recipe?.targetOg ?? 1.055 }
      ),
      ibuStale: false
    };
  }
}
