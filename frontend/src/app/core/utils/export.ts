/**
 * 配方 JSON 序列化与校验
 * 罐装页用于导出配方实绩档案，也是「导入导出备份」的数据校验入口。
 */
import type { Recipe } from '../models/recipe.model';
import type { Malt } from '../models/malt.model';
import type { Hop } from '../models/hop.model';
import type { RecipeMalt } from '../models/recipe-malt.model';
import type { MashStep } from '../models/mash-step.model';
import type { BoilAdd } from '../models/boil-add.model';
import type { Ferment } from '../models/ferment.model';
import type { Packaging } from '../models/packaging.model';
import { DB_NAME, DB_SCHEMA_VERSION, db } from './db';
import { abvFromGravity, apparentAttenuation, totalGrainKg } from './brew';
import { weightedEbcFromRefs } from './derived';
import { nowIso } from './uuid';

/** 配方实绩档案 */
export interface RecipeArchive {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  recipe: Recipe;
  /** 本配方引用到的麦芽主档 */
  malts: Malt[];
  /** 本配方的麦芽投料行（含色度快照与待重算标记） */
  recipeMalts: RecipeMalt[];
  /** 本配方引用到的酒花主档 */
  hops: Hop[];
  mashSteps: MashStep[];
  boilAdds: BoilAdd[];
  ferments: Ferment[];
  packagings: Packaging[];
  summary: {
    maltCount: number;
    hopCount: number;
    mashStepCount: number;
    boilAddCount: number;
    fermentCount: number;
    grainKg: number;
    avgEbc: number;
    og: number;
    fg: number;
    abv: number;
    attenuation: number;
    packagedQuantity: number;
  };
}

type WithRevision = { revision?: number; createdAt?: number; updatedAt?: number };

function stripRevision<T extends WithRevision>(row: T): T {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.revision;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy as T;
}

/** 汇总某个配方的实绩档案（主档只导出被该配方引用到的部分） */
export async function buildRecipeArchive(recipeId: string): Promise<RecipeArchive> {
  const recipe = await db.recipes.get(recipeId);
  if (!recipe) throw new Error('配方不存在，无法导出档案');
  const [recipeMalts, allMalts, mashSteps, boilAdds, ferments, packagings] = await Promise.all([
    db.recipeMalts.where('recipeId').equals(recipeId).toArray(),
    db.malts.toArray(),
    db.mashSteps.where('recipeId').equals(recipeId).toArray(),
    db.boilAdds.where('recipeId').equals(recipeId).toArray(),
    db.ferments.where('recipeId').equals(recipeId).toArray(),
    db.packagings.where('recipeId').equals(recipeId).toArray()
  ]);
  const allHops = await db.hops.toArray();
  const maltIds = new Set(recipeMalts.map((item) => item.maltId));
  const hopIds = new Set(boilAdds.map((item) => item.hopId).filter((id): id is string => id !== null));
  const malts = allMalts.filter((item) => maltIds.has(item.id));
  const hops = allHops.filter((item) => hopIds.has(item.id));
  const sortedFerments = [...ferments].sort((a, b) => a.date.localeCompare(b.date));
  const og = sortedFerments.length > 0 ? sortedFerments[0].gravity : recipe.targetOg;
  const fg = sortedFerments.length > 0 ? sortedFerments[sortedFerments.length - 1].gravity : recipe.targetFg;

  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    recipe: stripRevision(recipe),
    malts: malts.map(stripRevision),
    recipeMalts: recipeMalts.map(stripRevision),
    hops: hops.map(stripRevision),
    mashSteps: mashSteps.map(stripRevision),
    boilAdds: boilAdds.map(stripRevision),
    ferments: sortedFerments.map(stripRevision),
    packagings: packagings.map(stripRevision),
    summary: {
      maltCount: recipeMalts.length,
      hopCount: hops.length,
      mashStepCount: mashSteps.length,
      boilAddCount: boilAdds.length,
      fermentCount: ferments.length,
      grainKg: totalGrainKg(recipe.batchSizeL, recipe.targetOg),
      avgEbc: weightedEbcFromRefs(recipeMalts.map((item) => ({ ebcSnapshot: item.ebcSnapshot, ratioPct: item.ratioPct }))),
      og,
      fg,
      abv: abvFromGravity(og, fg),
      attenuation: apparentAttenuation(og, fg),
      packagedQuantity: packagings.reduce((sum, item) => sum + item.quantity, 0)
    }
  };
}

export function serializeArchive(archive: RecipeArchive): string {
  return JSON.stringify(archive, null, 2);
}

/** 校验并解析档案 / 备份 JSON，失败时抛出可读错误 */
export function parseArchive(text: string): RecipeArchive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON 文本');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('档案根节点必须是对象');
  }
  const candidate = parsed as Partial<RecipeArchive>;
  if (typeof candidate.name !== 'string') throw new Error('缺少 name 字段');
  if (typeof candidate.schemaVersion !== 'number') throw new Error('缺少 schemaVersion 字段');
  if (!candidate.recipe || typeof candidate.recipe.id !== 'string') throw new Error('缺少 recipe.id 字段');
  if (!Array.isArray(candidate.malts)) throw new Error('malts 必须是数组');
  return candidate as RecipeArchive;
}

/** 触发浏览器下载（纯前端，无需后端） */
export function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
