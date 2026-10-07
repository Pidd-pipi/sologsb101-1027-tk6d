/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据库名 gbbrewhouse-db，数据结构版本号 version(2) 与 upgrade() 迁移逻辑
 * - v2：辅料拆为「主档」（maltCatalog / hopCatalog，色度与 α 酸唯一出处）
 *   与「配方用料」（recipeMalts / hopUsages，只记用量）；煮沸投加改用 hopId 认酒花主档
 * - 配方 / 麦芽主档 / 酒花主档 / 配方麦芽 / 配方酒花 / 糖化步 / 煮沸投加 / 发酵读数 / 罐装批次 分表存储
 * - 首次打开自动播种互相引用的演示数据，保证每个页面打开都有内容
 */
import Dexie, { type Table } from 'dexie';
import type { Recipe } from '../models/recipe.model';
import type { MaltCatalog, RecipeMalt } from '../models/malt.model';
import type { HopCatalog, HopUsage } from '../models/hop.model';
import type { MashStep } from '../models/mash-step.model';
import type { BoilAdd } from '../models/boil-add.model';
import type { Ferment } from '../models/ferment.model';
import type { Packaging } from '../models/packaging.model';
import { nowIso } from './uuid';
import { seedDatabase } from './seed';

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
export type MaltCatalogRow = MaltCatalog & Revisioned;
export type HopCatalogRow = HopCatalog & Revisioned;
export type RecipeMaltRow = RecipeMalt & Revisioned;
export type HopUsageRow = HopUsage & Revisioned;
export type MashStepRow = MashStep & Revisioned;
export type BoilAddRow = BoilAdd & Revisioned;
export type FermentRow = Ferment & Revisioned;
export type PackagingRow = Packaging & Revisioned;

/** 删除主档时仍被配方用料 / 投花引用：拦下来让人先处理引用 */
export class ReferenceBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceBlockedError';
  }
}

/** v1 → v2 迁移产物：主档 + 配方用料四张表的行（不含时间戳的由调用方补） */
export interface MigratedIngredients {
  maltCatalog: Array<MaltCatalog & Partial<Revisioned>>;
  hopCatalog: Array<HopCatalog & Partial<Revisioned>>;
  recipeMalts: Array<RecipeMalt & Partial<Revisioned>>;
  hopUsages: Array<HopUsage & Partial<Revisioned>>;
}

type LegacyMaltRow = { id: string; recipeId?: string; name?: string; ebc?: number; origin?: string; ratioPct?: number; type?: string };
type LegacyHopRow = { id: string; recipeId?: string; name?: string; alphaPct?: number; origin?: string; form?: string; amountG?: number };

/**
 * v1 旧数据迁移：按名字去重归并出主档，配方行改认主档 id。
 * 升级迁移与旧版备份导入共用同一段逻辑，保证两条路径认档结果一致。
 */
export function migrateLegacyIngredients(input: {
  malts: LegacyMaltRow[];
  hops: LegacyHopRow[];
}): MigratedIngredients {
  const maltCatalog = new Map<string, MaltCatalog & Partial<Revisioned>>();
  const hopCatalog = new Map<string, HopCatalog & Partial<Revisioned>>();
  const recipeMalts: Array<RecipeMalt & Partial<Revisioned>> = [];
  const hopUsages: Array<HopUsage & Partial<Revisioned>> = [];
  let maltSeq = 0;
  let hopSeq = 0;

  input.malts.forEach((row) => {
    const name = String(row.name ?? '').trim();
    let catalog = maltCatalog.get(name);
    if (!catalog) {
      maltSeq += 1;
      catalog = {
        id: `mc-${String(maltSeq).padStart(3, '0')}`,
        name,
        ebc: typeof row.ebc === 'number' ? row.ebc : 4,
        origin: String(row.origin ?? ''),
        type: (row.type as MaltCatalog['type']) ?? '基础麦芽'
      };
      maltCatalog.set(name, catalog);
    }
    recipeMalts.push({
      id: row.id,
      recipeId: String(row.recipeId ?? ''),
      maltId: catalog.id,
      name,
      ratioPct: typeof row.ratioPct === 'number' ? row.ratioPct : 0,
      stale: false
    });
  });

  input.hops.forEach((row) => {
    const name = String(row.name ?? '').trim();
    let catalog = hopCatalog.get(name);
    if (!catalog) {
      hopSeq += 1;
      catalog = {
        id: `hc-${String(hopSeq).padStart(3, '0')}`,
        name,
        alphaPct: typeof row.alphaPct === 'number' ? row.alphaPct : 8,
        origin: String(row.origin ?? ''),
        form: (row.form as HopCatalog['form']) ?? '颗粒'
      };
      hopCatalog.set(name, catalog);
    }
    hopUsages.push({
      id: row.id,
      recipeId: String(row.recipeId ?? ''),
      hopId: catalog.id,
      name,
      amountG: typeof row.amountG === 'number' ? row.amountG : 0,
      stale: false
    });
  });

  return {
    maltCatalog: [...maltCatalog.values()],
    hopCatalog: [...hopCatalog.values()],
    recipeMalts,
    hopUsages
  };
}

/**
 * 旧数据里照名字写的投花：按名字认到酒花主档；认不出的 hopId 留 null，等人指认。
 * 澄清类辅料（爱尔兰苔藓等）不属于酒花，直接置 null。
 */
export function backfillBoilAddHopIds(
  adds: Array<Record<string, unknown>>,
  hopCatalogRows: Array<Pick<HopCatalog, 'id' | 'name'>>
): void {
  const byName = new Map(hopCatalogRows.map((hop) => [hop.name.trim(), hop.id]));
  adds.forEach((row) => {
    if (row['purpose'] === '澄清') {
      row['hopId'] = null;
    } else if (typeof row['hopId'] !== 'string' && row['hopId'] !== null) {
      const material = String(row['material'] ?? '').trim();
      row['hopId'] = byName.get(material) ?? null;
    }
    if (typeof row['stale'] !== 'boolean') row['stale'] = false;
  });
}

class GbBrewhouseDatabase extends Dexie {
  recipes!: Table<RecipeRow, string>;
  maltCatalog!: Table<MaltCatalogRow, string>;
  hopCatalog!: Table<HopCatalogRow, string>;
  recipeMalts!: Table<RecipeMaltRow, string>;
  hopUsages!: Table<HopUsageRow, string>;
  mashSteps!: Table<MashStepRow, string>;
  boilAdds!: Table<BoilAddRow, string>;
  ferments!: Table<FermentRow, string>;
  packagings!: Table<PackagingRow, string>;

  constructor() {
    super(DB_NAME);

    // v1 初始结构：malts / hops 同时承担主档与配方用料
    this.version(1)
      .stores({
        recipes: 'id, name, style, targetOg, updatedAt',
        malts: 'id, recipeId, name, ebc, type, updatedAt',
        hops: 'id, recipeId, name, alphaPct, form, updatedAt',
        mashSteps: 'id, recipeId, seq, state, updatedAt',
        boilAdds: 'id, recipeId, atMin, purpose, updatedAt',
        ferments: 'id, recipeId, batchNo, date, state, updatedAt',
        packagings: 'id, recipeId, batchNo, packDate, container, updatedAt'
      })
      .upgrade(async (tx) => {
        // v1 结构迁移：为历史行补齐行修订号与时间戳；新建库时各表为空，迁移天然幂等
        const tableNames = ['recipes', 'malts', 'hops', 'mashSteps', 'boilAdds', 'ferments', 'packagings'];
        for (const name of tableNames) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              row.revision = 1;
              if (typeof row.createdAt !== 'number') row.createdAt = Date.now();
              if (typeof row.updatedAt !== 'number') row.updatedAt = row.createdAt;
            });
        }
      });

    // v2：主档与配方用料拆表，煮沸投加改认 hopId
    this.version(2)
      .stores({
        recipes: 'id, name, style, targetOg, updatedAt',
        maltCatalog: 'id, name, ebc, type, updatedAt',
        hopCatalog: 'id, name, alphaPct, form, updatedAt',
        recipeMalts: 'id, recipeId, maltId, stale, updatedAt',
        hopUsages: 'id, recipeId, hopId, stale, updatedAt',
        mashSteps: 'id, recipeId, seq, state, updatedAt',
        boilAdds: 'id, recipeId, hopId, atMin, purpose, stale, updatedAt',
        ferments: 'id, recipeId, batchNo, date, state, updatedAt',
        packagings: 'id, recipeId, batchNo, packDate, container, updatedAt',
        // v2 起旧的混合表删除：主档与配方用料拆成四张表
        malts: null,
        hops: null
      })
      .upgrade(async (tx) => {
        // 结构迁移：为历史行补齐行修订号与时间戳（新建库各表为空，天然幂等）
        const tableNames = ['recipes', 'mashSteps', 'boilAdds', 'ferments', 'packagings'];
        for (const name of tableNames) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              row.revision = ROW_REVISION;
              if (typeof row.createdAt !== 'number') row.createdAt = Date.now();
              if (typeof row.updatedAt !== 'number') row.updatedAt = row.createdAt;
            });
        }

        // 旧 malts / hops：按名字归并出主档，配方行改认主档 id
        const legacyMalts = (await tx.table('malts').toArray()) as LegacyMaltRow[];
        const legacyHops = (await tx.table('hops').toArray()) as LegacyHopRow[];
        const migrated = migrateLegacyIngredients({ malts: legacyMalts, hops: legacyHops });

        const stamp = <T extends object>(row: T): T & Revisioned => ({
          ...row,
          revision: ROW_REVISION,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        await tx.table('maltCatalog').bulkPut(migrated.maltCatalog.map(stamp));
        await tx.table('hopCatalog').bulkPut(migrated.hopCatalog.map(stamp));
        await tx.table('recipeMalts').bulkPut(migrated.recipeMalts.map(stamp));
        await tx.table('hopUsages').bulkPut(migrated.hopUsages.map(stamp));

        // 旧投花照名字认主档，认不出的 hopId 留 null
        const legacyAdds = (await tx.table('boilAdds').toArray()) as Array<Record<string, unknown>>;
        backfillBoilAddHopIds(legacyAdds, migrated.hopCatalog);
        await tx.table('boilAdds').clear();
        await tx.table('boilAdds').bulkPut(legacyAdds);
        // v2 stores 未声明 malts / hops，升级结束后 Dexie 自动删除这两张旧表
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

/** 删除配方：级联删除其配方麦芽、配方酒花、糖化步、煮沸投加、发酵读数与罐装批次 */
export async function removeRecipe(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.recipes,
      db.maltCatalog,
      db.hopCatalog,
      db.recipeMalts,
      db.hopUsages,
      db.mashSteps,
      db.boilAdds,
      db.ferments,
      db.packagings
    ],
    async () => {
      // 主档被删配方独占时一并清掉；仍被别的配方引用的主档保留（主档是入库登记，不随配方强删）
      const ownMalts = await db.recipeMalts.where('recipeId').equals(id).toArray();
      const ownHops = await db.hopUsages.where('recipeId').equals(id).toArray();
      for (const usage of ownMalts) {
        const others = await db.recipeMalts.where('maltId').equals(usage.maltId).count();
        if (others <= 1) await db.maltCatalog.delete(usage.maltId);
      }
      for (const usage of ownHops) {
        const others = await db.hopUsages.where('hopId').equals(usage.hopId).count();
        if (others <= 1) await db.hopCatalog.delete(usage.hopId);
      }
      await db.recipeMalts.where('recipeId').equals(id).delete();
      await db.hopUsages.where('recipeId').equals(id).delete();
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
  maltCatalog: MaltCatalog[];
  hopCatalog: HopCatalog[];
  recipeMalts: RecipeMalt[];
  hopUsages: HopUsage[];
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
  const [recipes, maltCatalog, hopCatalog, recipeMalts, hopUsages, mashSteps, boilAdds, ferments, packagings] =
    await Promise.all([
      db.recipes.toArray(),
      db.maltCatalog.toArray(),
      db.hopCatalog.toArray(),
      db.recipeMalts.toArray(),
      db.hopUsages.toArray(),
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
    maltCatalog: maltCatalog.map(stripRow),
    hopCatalog: hopCatalog.map(stripRow),
    recipeMalts: recipeMalts.map(stripRow),
    hopUsages: hopUsages.map(stripRow),
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

type RawSnapshot = {
  recipes: Recipe[];
  maltCatalog?: MaltCatalog[];
  hopCatalog?: HopCatalog[];
  recipeMalts?: RecipeMalt[];
  hopUsages?: HopUsage[];
  mashSteps?: MashStep[];
  boilAdds?: Array<Record<string, unknown>>;
  ferments?: Ferment[];
  packagings?: Packaging[];
  // v1 备份字段
  malts?: LegacyMaltRow[];
  hops?: LegacyHopRow[];
};

/**
 * 兼容旧版（v1）备份：malts / hops 按名字迁成主档 + 配方用料，
 * 投花按名字补 hopId，认不出的留 null。v2 备份原样返回。
 */
function normalizeSnapshot(raw: RawSnapshot): Omit<DatabaseSnapshot, 'name' | 'schemaVersion' | 'exportedAt'> {
  const base = {
    recipes: raw.recipes ?? [],
    mashSteps: raw.mashSteps ?? [],
    boilAdds: (raw.boilAdds ?? []) as unknown as BoilAdd[],
    ferments: raw.ferments ?? [],
    packagings: raw.packagings ?? []
  };

  if (raw.malts || raw.hops) {
    const migrated = migrateLegacyIngredients({ malts: raw.malts ?? [], hops: raw.hops ?? [] });
    const adds = (raw.boilAdds ?? []) as Array<Record<string, unknown>>;
    backfillBoilAddHopIds(adds, migrated.hopCatalog);
    return {
      ...base,
      boilAdds: adds as unknown as BoilAdd[],
      maltCatalog: migrated.maltCatalog,
      hopCatalog: migrated.hopCatalog,
      recipeMalts: migrated.recipeMalts,
      hopUsages: migrated.hopUsages
    };
  }

  return {
    ...base,
    maltCatalog: raw.maltCatalog ?? [],
    hopCatalog: raw.hopCatalog ?? [],
    recipeMalts: raw.recipeMalts ?? [],
    hopUsages: raw.hopUsages ?? []
  };
}

export async function importSnapshot(snapshot: Partial<DatabaseSnapshot> | RawSnapshot): Promise<void> {
  const normalized = normalizeSnapshot(snapshot as RawSnapshot);
  await db.transaction(
    'rw',
    [
      db.recipes,
      db.maltCatalog,
      db.hopCatalog,
      db.recipeMalts,
      db.hopUsages,
      db.mashSteps,
      db.boilAdds,
      db.ferments,
      db.packagings
    ],
    async () => {
      await Promise.all([
        db.recipes.clear(),
        db.maltCatalog.clear(),
        db.hopCatalog.clear(),
        db.recipeMalts.clear(),
        db.hopUsages.clear(),
        db.mashSteps.clear(),
        db.boilAdds.clear(),
        db.ferments.clear(),
        db.packagings.clear()
      ]);
      await db.recipes.bulkPut(normalized.recipes.map(stamp));
      await db.maltCatalog.bulkPut(normalized.maltCatalog.map(stamp));
      await db.hopCatalog.bulkPut(normalized.hopCatalog.map(stamp));
      await db.recipeMalts.bulkPut(normalized.recipeMalts.map(stamp));
      await db.hopUsages.bulkPut(normalized.hopUsages.map(stamp));
      await db.mashSteps.bulkPut(normalized.mashSteps.map(stamp));
      await db.boilAdds.bulkPut(normalized.boilAdds.map(stamp));
      await db.ferments.bulkPut(normalized.ferments.map(stamp));
      await db.packagings.bulkPut(normalized.packagings.map(stamp));
    }
  );
}

/** 清空全部数据并重新灌入演示数据 */
export async function resetDatabase(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.recipes,
      db.maltCatalog,
      db.hopCatalog,
      db.recipeMalts,
      db.hopUsages,
      db.mashSteps,
      db.boilAdds,
      db.ferments,
      db.packagings
    ],
    async () => {
      await Promise.all([
        db.recipes.clear(),
        db.maltCatalog.clear(),
        db.hopCatalog.clear(),
        db.recipeMalts.clear(),
        db.hopUsages.clear(),
        db.mashSteps.clear(),
        db.boilAdds.clear(),
        db.ferments.clear(),
        db.packagings.clear()
      ]);
    }
  );
  await seedDatabase();
}

/** 各表行数统计 */
export async function countAll(): Promise<Record<string, number>> {
  const [recipes, maltCatalog, hopCatalog, recipeMalts, hopUsages, mashSteps, boilAdds, ferments, packagings] =
    await Promise.all([
      db.recipes.count(),
      db.maltCatalog.count(),
      db.hopCatalog.count(),
      db.recipeMalts.count(),
      db.hopUsages.count(),
      db.mashSteps.count(),
      db.boilAdds.count(),
      db.ferments.count(),
      db.packagings.count()
    ]);
  return { recipes, maltCatalog, hopCatalog, recipeMalts, hopUsages, mashSteps, boilAdds, ferments, packagings };
}
