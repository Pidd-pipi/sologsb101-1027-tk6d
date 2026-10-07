/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据库名 gbbrewhouse-db，数据结构版本号 version(2) 与 upgrade() 迁移逻辑
 * - 配方 / 麦芽主档 / 酒花主档 / 配方麦芽投料 / 糖化步 / 煮沸投加 / 发酵读数 / 罐装批次 八张表
 * - 主档（malts / hops）是色度与 α 酸的唯一出处；配方麦芽投料与煮沸投花按 id 引用主档
 * - v1 → v2：旧的按配方麦芽 / 酒花行收敛为主档，旧的照名字写的投花按名字认主档，
 *   认不出的投花留空（nonHop=false）进入待指认
 * - 首次打开自动播种互相引用的演示数据，保证每个页面打开都有内容
 */
import Dexie, { type Table } from 'dexie';
import type { Recipe } from '../models/recipe.model';
import type { Malt } from '../models/malt.model';
import type { Hop } from '../models/hop.model';
import type { RecipeMalt } from '../models/recipe-malt.model';
import type { MashStep } from '../models/mash-step.model';
import type { BoilAdd } from '../models/boil-add.model';
import type { Ferment } from '../models/ferment.model';
import type { Packaging } from '../models/packaging.model';
import { nowIso } from './uuid';
import { createId } from './uuid';
import { seedDatabase } from './seed';
import { boilAddIbu, resolveV1BoilAdd, weightedEbcFromRefs } from './derived';

/** 数据库名 */
export const DB_NAME = 'gbbrewhouse-db';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_SCHEMA_VERSION = 2;

/** 行结构修订号 */
export const ROW_REVISION = 2;

export interface Revisioned {
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export type RecipeRow = Recipe & Revisioned;
export type MaltRow = Malt & Revisioned;
export type HopRow = Hop & Revisioned;
export type RecipeMaltRow = RecipeMalt & Revisioned;
export type MashStepRow = MashStep & Revisioned;
export type BoilAddRow = BoilAdd & Revisioned;
export type FermentRow = Ferment & Revisioned;
export type PackagingRow = Packaging & Revisioned;

/* eslint-disable @typescript-eslint/no-explicit-any */
interface V1MaltRow {
  id: string;
  recipeId?: string;
  name?: string;
  ebc?: number;
  origin?: string;
  ratioPct?: number;
  type?: Malt['type'];
  revision?: number;
  createdAt?: number;
  updatedAt?: number;
}
interface V1HopRow {
  id: string;
  recipeId?: string;
  name?: string;
  alphaPct?: number;
  origin?: string;
  form?: Hop['form'];
  amountG?: number;
  revision?: number;
  createdAt?: number;
  updatedAt?: number;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

class GbBrewhouseDatabase extends Dexie {
  recipes!: Table<RecipeRow, string>;
  malts!: Table<MaltRow, string>;
  hops!: Table<HopRow, string>;
  recipeMalts!: Table<RecipeMaltRow, string>;
  mashSteps!: Table<MashStepRow, string>;
  boilAdds!: Table<BoilAddRow, string>;
  ferments!: Table<FermentRow, string>;
  packagings!: Table<PackagingRow, string>;

  constructor() {
    super(DB_NAME);

    // v1（历史结构）：麦芽 / 酒花挂在配方下，煮沸投花只有 material 名字
    this.version(1).stores({
      recipes: 'id, name, style, targetOg, updatedAt',
      malts: 'id, recipeId, name, ebc, type, updatedAt',
      hops: 'id, recipeId, name, alphaPct, form, updatedAt',
      mashSteps: 'id, recipeId, seq, state, updatedAt',
      boilAdds: 'id, recipeId, atMin, purpose, updatedAt',
      ferments: 'id, recipeId, batchNo, date, state, updatedAt',
      packagings: 'id, recipeId, batchNo, packDate, container, updatedAt'
    });

    // v2：麦芽 / 酒花独立为主档；新增配方麦芽投料表；投花按 hopId 认主档
    this.version(2)
      .stores({
        recipes: 'id, name, style, targetOg, updatedAt',
        malts: 'id, name, ebc, type, updatedAt',
        hops: 'id, name, alphaPct, form, updatedAt',
        recipeMalts: 'id, recipeId, maltId, updatedAt',
        mashSteps: 'id, recipeId, seq, state, updatedAt',
        boilAdds: 'id, recipeId, atMin, purpose, hopId, updatedAt',
        ferments: 'id, recipeId, batchNo, date, state, updatedAt',
        packagings: 'id, recipeId, batchNo, packDate, container, updatedAt'
      })
      .upgrade(async (tx) => {
        const now = Date.now();
        const stampTime = (row: { createdAt?: number; updatedAt?: number }) => {
          if (typeof row.createdAt !== 'number') row.createdAt = now;
          if (typeof row.updatedAt !== 'number') row.updatedAt = row.createdAt;
          (row as { revision: number }).revision = ROW_REVISION;
        };

        /* ---- 麦芽：按名字去重收敛为主档，每个旧行转成一条配方投料引用 ---- */
        const oldMalts = (await tx.table('malts').toArray()) as V1MaltRow[];
        const maltMasterByName = new Map<string, MaltRow>();
        for (const row of oldMalts) {
          const name = String(row.name ?? '').trim();
          if (!name || maltMasterByName.has(name)) continue;
          const master: MaltRow = {
            id: row.id,
            name,
            ebc: typeof row.ebc === 'number' ? row.ebc : 0,
            origin: row.origin ?? '',
            type: row.type ?? '基础麦芽',
            revision: ROW_REVISION,
            createdAt: row.createdAt ?? now,
            updatedAt: now
          };
          maltMasterByName.set(name, master);
        }
        const recipeMaltRows: RecipeMaltRow[] = oldMalts.map((row) => {
          const name = String(row.name ?? '').trim();
          const master = maltMasterByName.get(name);
          return {
            id: createId('rm'),
            recipeId: String(row.recipeId ?? ''),
            maltId: master?.id ?? '',
            ratioPct: typeof row.ratioPct === 'number' ? row.ratioPct : 0,
            nameSnapshot: master?.name ?? name,
            ebcSnapshot: master?.ebc ?? (typeof row.ebc === 'number' ? row.ebc : 0),
            ebcStale: false,
            revision: ROW_REVISION,
            createdAt: row.createdAt ?? now,
            updatedAt: now
          };
        });
        await tx.table('malts').clear();
        await tx.table('malts').bulkPut([...maltMasterByName.values()]);
        await tx.table('recipeMalts').bulkPut(recipeMaltRows);

        /* ---- 酒花：按名字去重收敛为全局主档 ---- */
        const oldHops = (await tx.table('hops').toArray()) as V1HopRow[];
        const hopMasterByName = new Map<string, HopRow>();
        for (const row of oldHops) {
          const name = String(row.name ?? '').trim();
          if (!name || hopMasterByName.has(name)) continue;
          const master: HopRow = {
            id: row.id,
            name,
            alphaPct: typeof row.alphaPct === 'number' ? row.alphaPct : 0,
            origin: row.origin ?? '',
            form: row.form ?? '颗粒',
            revision: ROW_REVISION,
            createdAt: row.createdAt ?? now,
            updatedAt: now
          };
          hopMasterByName.set(name, master);
        }
        await tx.table('hops').clear();
        await tx.table('hops').bulkPut([...hopMasterByName.values()]);

        /* ---- 煮沸投花：旧数据照名字认主档，认不出的留待人工指认 ---- */
        const oldRecipes = (await tx.table('recipes').toArray()) as Array<{
          id: string;
          batchSizeL?: number;
          targetOg?: number;
        }>;
        const recipeById = new Map(oldRecipes.map((row) => [row.id, row]));
        await tx
          .table('boilAdds')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            const recipe = recipeById.get(String(row['recipeId']));
            Object.assign(
              row,
              resolveV1BoilAdd(
                row as Parameters<typeof resolveV1BoilAdd>[0],
                hopMasterByName,
                recipe as Parameters<typeof resolveV1BoilAdd>[2]
              )
            );
            stampTime(row as { createdAt?: number; updatedAt?: number });
          });

        /* ---- 配方：补加权色度缓存与待重算标记（迁移当时全部为最新） ---- */
        const refsByRecipe = new Map<string, Array<{ ebcSnapshot: number; ratioPct: number }>>();
        for (const ref of recipeMaltRows) {
          const list = refsByRecipe.get(ref.recipeId) ?? [];
          list.push({ ebcSnapshot: ref.ebcSnapshot, ratioPct: ref.ratioPct });
          refsByRecipe.set(ref.recipeId, list);
        }
        await tx
          .table('recipes')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            const refs = refsByRecipe.get(String(row['id'])) ?? [];
            row['ebcSnapshot'] = weightedEbcFromRefs(refs);
            row['ebcStale'] = false;
            stampTime(row as { createdAt?: number; updatedAt?: number });
          });

        // 其余表补齐行修订号与时间戳
        for (const name of ['mashSteps', 'ferments', 'packagings'] as const) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              stampTime(row as { createdAt?: number; updatedAt?: number });
            });
        }
      });
  }
}

export const db = new GbBrewhouseDatabase();

/** 初始化 Promise 缓存：并发调用共享同一次「打开 + 按需播种」，避免重复灌入演示数据 */
let initPromise: Promise<void> | null = null;

/** 打开数据库：首次使用时灌入演示数据（幂等：表非空不播；并发调用复用同一 Promise） */
export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await db.open();
      if ((await db.recipes.count()) === 0) {
        await seedDatabase();
      }
    })().catch((error: unknown) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

/* ------------------------------ 配方 ------------------------------ */

export async function listRecipes(): Promise<RecipeRow[]> {
  const rows = await db.recipes.toArray();
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/** 删除配方：级联删除其配方麦芽投料、糖化步、煮沸投加、发酵读数与罐装批次（主档保留） */
export async function removeRecipe(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.recipes, db.recipeMalts, db.mashSteps, db.boilAdds, db.ferments, db.packagings],
    async () => {
      await db.recipeMalts.where('recipeId').equals(id).delete();
      await db.mashSteps.where('recipeId').equals(id).delete();
      await db.boilAdds.where('recipeId').equals(id).delete();
      await db.ferments.where('recipeId').equals(id).delete();
      await db.packagings.where('recipeId').equals(id).delete();
      await db.recipes.delete(id);
    }
  );
}

/* --------------------------- 整库导入导出 --------------------------- */

export interface DatabaseSnapshot {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  recipes: Recipe[];
  malts: Malt[];
  hops: Hop[];
  recipeMalts: RecipeMalt[];
  mashSteps: MashStep[];
  boilAdds: BoilAdd[];
  ferments: Ferment[];
  packagings: Packaging[];
}

function stripRow<T extends Revisioned>(row: T): Omit<T, keyof Revisioned> {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.revision;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy as Omit<T, keyof Revisioned>;
}

export async function exportSnapshot(): Promise<DatabaseSnapshot> {
  const [recipes, malts, hops, recipeMalts, mashSteps, boilAdds, ferments, packagings] = await Promise.all([
    db.recipes.toArray(),
    db.malts.toArray(),
    db.hops.toArray(),
    db.recipeMalts.toArray(),
    db.mashSteps.toArray(),
    db.boilAdds.toArray(),
    db.ferments.toArray(),
    db.packagings.toArray()
  ]);
  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    recipes: recipes.map(stripRow),
    malts: malts.map(stripRow),
    hops: hops.map(stripRow),
    recipeMalts: recipeMalts.map(stripRow),
    mashSteps: mashSteps.map(stripRow),
    boilAdds: boilAdds.map(stripRow),
    ferments: ferments.map(stripRow),
    packagings: packagings.map(stripRow)
  };
}

function stamp<T>(row: T): T & Revisioned {
  const now = Date.now();
  return { ...row, revision: ROW_REVISION, createdAt: now, updatedAt: now };
}

/**
 * 导入后归一化：补齐新字段，并按主档重算全部色度 / 苦度快照。
 * 旧版备份（无 hopId / 无 recipeMalts）在这里按与结构迁移相同的规则认主档，认不出的留待指认。
 */
async function normalizeImported(): Promise<void> {
  const [malts, hops, recipes, recipeMalts, boilAdds] = await Promise.all([
    db.malts.toArray(),
    db.hops.toArray(),
    db.recipes.toArray(),
    db.recipeMalts.toArray(),
    db.boilAdds.toArray()
  ]);
  const maltById = new Map(malts.map((item) => [item.id, item]));
  const hopById = new Map(hops.map((item) => [item.id, item]));
  const recipeById = new Map(recipes.map((item) => [item.id, item]));
  const now = Date.now();

  // 配方麦芽投料：刷新色度快照；主档缺失的行保持待重算
  const fixedRefs: RecipeMaltRow[] = recipeMalts.map((ref) => {
    const master = maltById.get(ref.maltId);
    return {
      ...ref,
      nameSnapshot: master?.name ?? ref.nameSnapshot,
      ebcSnapshot: master ? master.ebc : ref.ebcSnapshot,
      ebcStale: !master,
      updatedAt: now
    };
  });

  // 配方：按投料行重算加权色度缓存
  const refsByRecipe = new Map<string, RecipeMaltRow[]>();
  for (const ref of fixedRefs) {
    const list = refsByRecipe.get(ref.recipeId) ?? [];
    list.push(ref);
    refsByRecipe.set(ref.recipeId, list);
  }
  const fixedRecipes: RecipeRow[] = recipes.map((recipe) => {
    const refs = refsByRecipe.get(recipe.id) ?? [];
    const stale = refs.some((ref) => ref.ebcStale);
    return {
      ...recipe,
      ebcSnapshot: weightedEbcFromRefs(refs.map((ref) => ({ ebcSnapshot: ref.ebcSnapshot, ratioPct: ref.ratioPct }))),
      ebcStale: stale,
      updatedAt: now
    };
  });

  // 煮沸投花：按 hopId 找主档刷新 α 酸 / IBU 快照；
  // 旧版备份没有 hopId，先按 material 名字认主档；认不到（且非澄清辅料）退回待指认
  const hopsByName = new Map(hops.map((item) => [item.name.trim(), item]));
  const fixedAdds: BoilAddRow[] = boilAdds.map((add) => {
    const nonHop = add.nonHop === true || (add.hopId == null && add.purpose === '澄清');
    if (nonHop) {
      return { ...add, hopId: null, nonHop: true, alphaSnapshot: 0, ibuSnapshot: 0, ibuStale: false, updatedAt: now };
    }
    let hop = add.hopId ? hopById.get(add.hopId) : undefined;
    if (!hop) hop = hopsByName.get(String(add.material ?? '').trim());
    if (!hop) {
      return { ...add, hopId: null, nonHop: false, alphaSnapshot: 0, ibuSnapshot: 0, ibuStale: false, updatedAt: now };
    }
    const recipe = recipeById.get(add.recipeId);
    const alpha = hop.alphaPct;
    const ibu = boilAddIbu(alpha, add, { batchSizeL: recipe?.batchSizeL ?? 20, targetOg: recipe?.targetOg ?? 1.055 });
    return {
      ...add,
      hopId: hop.id,
      nonHop: false,
      material: hop.name,
      alphaSnapshot: alpha,
      ibuSnapshot: ibu,
      ibuStale: false,
      updatedAt: now
    };
  });

  await db.transaction('rw', [db.recipes, db.recipeMalts, db.boilAdds], async () => {
    if (fixedRefs.length > 0) await db.recipeMalts.bulkPut(fixedRefs);
    await db.recipes.bulkPut(fixedRecipes);
    await db.boilAdds.bulkPut(fixedAdds);
  });
}

export async function importSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.recipes,
      db.malts,
      db.hops,
      db.recipeMalts,
      db.mashSteps,
      db.boilAdds,
      db.ferments,
      db.packagings
    ],
    async () => {
      await Promise.all(
        [
          db.recipes,
          db.malts,
          db.hops,
          db.recipeMalts,
          db.mashSteps,
          db.boilAdds,
          db.ferments,
          db.packagings
        ].map((table) => table.clear())
      );
      await db.recipes.bulkPut((snapshot.recipes ?? []).map(stamp));
      await db.malts.bulkPut((snapshot.malts ?? []).map(stamp));
      await db.hops.bulkPut((snapshot.hops ?? []).map(stamp));
      await db.recipeMalts.bulkPut((snapshot.recipeMalts ?? []).map(stamp));
      await db.mashSteps.bulkPut((snapshot.mashSteps ?? []).map(stamp));
      await db.boilAdds.bulkPut((snapshot.boilAdds ?? []).map(stamp));
      await db.ferments.bulkPut((snapshot.ferments ?? []).map(stamp));
      await db.packagings.bulkPut((snapshot.packagings ?? []).map(stamp));
    }
  );
  await normalizeImported();
}

/** 清空全部数据并重新灌入演示数据 */
export async function resetDatabase(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.recipes,
      db.malts,
      db.hops,
      db.recipeMalts,
      db.mashSteps,
      db.boilAdds,
      db.ferments,
      db.packagings
    ],
    async () => {
      await Promise.all(
        [
          db.recipes,
          db.malts,
          db.hops,
          db.recipeMalts,
          db.mashSteps,
          db.boilAdds,
          db.ferments,
          db.packagings
        ].map((table) => table.clear())
      );
    }
  );
  await seedDatabase();
}

/** 各表行数统计 */
export async function countAll(): Promise<Record<string, number>> {
  const [recipes, malts, hops, recipeMalts, mashSteps, boilAdds, ferments, packagings] = await Promise.all([
    db.recipes.count(),
    db.malts.count(),
    db.hops.count(),
    db.recipeMalts.count(),
    db.mashSteps.count(),
    db.boilAdds.count(),
    db.ferments.count(),
    db.packagings.count()
  ]);
  return { recipes, malts, hops, recipeMalts, mashSteps, boilAdds, ferments, packagings };
}
