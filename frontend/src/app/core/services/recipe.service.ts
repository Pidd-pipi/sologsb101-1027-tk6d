/**
 * RecipeService：配方、辅料主档 / 配方用料及其他从属数据的读写收口。
 * 全部读写走 IdbTableService → Dexie → IndexedDB。
 *
 * 引用规则：
 * - 麦芽 / 酒花主档是色度 / α 酸的唯一出处；主档这些值一改，引用它的配方用料与投花全部置 stale，旧偏差作废。
 * - 删除主档时若仍被配方用料或投花引用，抛 ReferenceBlockedError 拦下来。
 * - 煮沸投花认酒花主档 hopId，不再照名字认。
 */
import { Injectable, inject } from '@angular/core';
import type { Recipe } from '../models/recipe.model';
import type { MaltCatalog, RecipeMalt } from '../models/malt.model';
import type { HopCatalog, HopUsage } from '../models/hop.model';
import type { MashStep } from '../models/mash-step.model';
import type { BoilAdd } from '../models/boil-add.model';
import type { Ferment } from '../models/ferment.model';
import type { Packaging } from '../models/packaging.model';
import {
  db,
  removeRecipe,
  ReferenceBlockedError,
  ROW_REVISION,
  type BoilAddRow,
  type FermentRow,
  type HopCatalogRow,
  type HopUsageRow,
  type MaltCatalogRow,
  type MashStepRow,
  type PackagingRow,
  type RecipeMaltRow,
  type RecipeRow
} from '../utils/db';
import { createId } from '../utils/uuid';
import { IdbTableService } from './idb-table.service';

@Injectable({ providedIn: 'root' })
export class RecipeService {
  private readonly idb = inject(IdbTableService);

  /* ------------------------------ 配方 ------------------------------ */

  listRecipes(): Promise<RecipeRow[]> {
    return db.recipes.toArray().then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')));
  }

  async createRecipe(payload: Omit<Recipe, 'id'>): Promise<string> {
    const row = this.idb.buildRow(payload, 'recipe') as RecipeRow;
    await db.recipes.put(row);
    return row.id;
  }

  updateRecipe(id: string, patch: Partial<Recipe>): Promise<void> {
    return this.idb.update(db.recipes, id, patch);
  }

  deleteRecipe(id: string): Promise<void> {
    return removeRecipe(id);
  }

  /* ---------------------------- 麦芽主档 ---------------------------- */

  listMaltCatalog(): Promise<MaltCatalogRow[]> {
    return db.maltCatalog.toArray();
  }

  async createMaltCatalog(payload: Omit<MaltCatalog, 'id'>): Promise<string> {
    const row = this.idb.buildRow(payload, 'mcat') as MaltCatalogRow;
    await db.maltCatalog.put(row);
    return row.id;
  }

  /** 改色度：引用该主档的配方麦芽全部标 stale，旧色度偏差作废重算 */
  async updateMaltCatalog(id: string, patch: Partial<MaltCatalog>): Promise<void> {
    await db.transaction('rw', [db.maltCatalog, db.recipeMalts], async () => {
      if (patch.ebc !== undefined) {
        const current = await db.maltCatalog.get(id);
        if (current && current.ebc !== patch.ebc) {
          await db.recipeMalts.where('maltId').equals(id).modify({ stale: true, updatedAt: Date.now() } as never);
        }
      }
      await this.idb.update(db.maltCatalog, id, patch);
    });
  }

  /** 仍被配方麦芽引用时禁止删除 */
  async deleteMaltCatalog(id: string): Promise<void> {
    const refCount = await db.recipeMalts.where('maltId').equals(id).count();
    if (refCount > 0) {
      throw new ReferenceBlockedError(`该麦芽仍被 ${refCount} 条配方用料引用，请先移除或更换配方中的麦芽`);
    }
    await this.idb.remove(db.maltCatalog, id);
  }

  /* ---------------------------- 酒花主档 ---------------------------- */

  listHopCatalog(): Promise<HopCatalogRow[]> {
    return db.hopCatalog.toArray();
  }

  async createHopCatalog(payload: Omit<HopCatalog, 'id'>): Promise<string> {
    const row = this.idb.buildRow(payload, 'hcat') as HopCatalogRow;
    await db.hopCatalog.put(row);
    return row.id;
  }

  /** 改 α 酸：引用该主档的配方酒花与煮沸投花全部标 stale，旧煮沸苦度作废重算 */
  async updateHopCatalog(id: string, patch: Partial<HopCatalog>): Promise<void> {
    await db.transaction('rw', [db.hopCatalog, db.hopUsages, db.boilAdds], async () => {
      if (patch.alphaPct !== undefined) {
        const current = await db.hopCatalog.get(id);
        if (current && current.alphaPct !== patch.alphaPct) {
          const now = Date.now();
          await db.hopUsages.where('hopId').equals(id).modify({ stale: true, updatedAt: now } as never);
          await db.boilAdds.where('hopId').equals(id).modify({ stale: true, updatedAt: now } as never);
        }
      }
      await this.idb.update(db.hopCatalog, id, patch);
    });
  }

  /** 仍被配方酒花或煮沸投花引用时禁止删除 */
  async deleteHopCatalog(id: string): Promise<void> {
    const [usageCount, boilCount] = await Promise.all([
      db.hopUsages.where('hopId').equals(id).count(),
      db.boilAdds.where('hopId').equals(id).count()
    ]);
    if (usageCount + boilCount > 0) {
      throw new ReferenceBlockedError(
        `该酒花仍被 ${usageCount} 条配方用料、${boilCount} 条煮沸投加引用，请先移除或更换引用后再删除`
      );
    }
    await this.idb.remove(db.hopCatalog, id);
  }

  /* ---------------------------- 配方麦芽 ---------------------------- */

  listRecipeMalts(): Promise<RecipeMaltRow[]> {
    return db.recipeMalts.toArray();
  }

  async createRecipeMalt(payload: Omit<RecipeMalt, 'id'>): Promise<string> {
    const row = {
      ...payload,
      stale: payload.stale ?? false,
      id: createId('rmalt'),
      revision: ROW_REVISION,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await db.recipeMalts.put(row);
    return row.id;
  }

  updateRecipeMalt(id: string, patch: Partial<RecipeMalt>): Promise<void> {
    return this.idb.update(db.recipeMalts, id, patch);
  }

  deleteRecipeMalt(id: string): Promise<void> {
    return this.idb.remove(db.recipeMalts, id);
  }

  /** 色度已按主档新值重算确认：摘掉该配方麦芽的 stale 标记 */
  markRecipeMaltFresh(id: string): Promise<void> {
    return this.idb.update(db.recipeMalts, id, { stale: false });
  }

  /* ---------------------------- 配方酒花 ---------------------------- */

  listHopUsages(): Promise<HopUsageRow[]> {
    return db.hopUsages.toArray();
  }

  async createHopUsage(payload: Omit<HopUsage, 'id'>): Promise<string> {
    const row = {
      ...payload,
      stale: payload.stale ?? false,
      id: createId('huse'),
      revision: ROW_REVISION,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await db.hopUsages.put(row);
    return row.id;
  }

  updateHopUsage(id: string, patch: Partial<HopUsage>): Promise<void> {
    return this.idb.update(db.hopUsages, id, patch);
  }

  deleteHopUsage(id: string): Promise<void> {
    return this.idb.remove(db.hopUsages, id);
  }

  /** α 酸已按主档新值重算确认：摘掉该配方酒花的 stale 标记 */
  markHopUsageFresh(id: string): Promise<void> {
    return this.idb.update(db.hopUsages, id, { stale: false });
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

  /* ---------------------------- 煮沸投加 ---------------------------- */

  listBoilAdds(): Promise<BoilAddRow[]> {
    return db.boilAdds.toArray();
  }

  async createBoilAdd(payload: Omit<BoilAdd, 'id'>): Promise<string> {
    const row = {
      ...payload,
      stale: payload.stale ?? false,
      id: createId('boil'),
      revision: ROW_REVISION,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await db.boilAdds.put(row);
    return row.id;
  }

  updateBoilAdd(id: string, patch: Partial<BoilAdd>): Promise<void> {
    return this.idb.update(db.boilAdds, id, patch);
  }

  deleteBoilAdd(id: string): Promise<void> {
    return this.idb.remove(db.boilAdds, id);
  }

  /** 人工把认不出主档的投加指认到酒花主档：落 hopId、同步物料名、摘掉 stale */
  async linkBoilAddHop(id: string, hopId: string): Promise<void> {
    const hop = await db.hopCatalog.get(hopId);
    if (!hop) throw new ReferenceBlockedError('指认的酒花主档不存在');
    await this.idb.update(db.boilAdds, id, { hopId, material: hop.name, stale: false });
  }

  /** 苦度已按主档新 α 酸重算确认：摘掉该投加的 stale 标记 */
  markBoilAddFresh(id: string): Promise<void> {
    return this.idb.update(db.boilAdds, id, { stale: false });
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
}
