/**
 * 配方 JSON 序列化与校验
 * 罐装页用于导出配方实绩档案，也是「导入导出备份」的数据校验入口。
 */
import type { Recipe } from '../models/recipe.model';
import type { MaltCatalog, RecipeMalt } from '../models/malt.model';
import type { HopCatalog, HopUsage } from '../models/hop.model';
import type { MashStep } from '../models/mash-step.model';
import type { BoilAdd } from '../models/boil-add.model';
import type { Ferment } from '../models/ferment.model';
import type { Packaging } from '../models/packaging.model';
import { DB_NAME, DB_SCHEMA_VERSION, db } from './db';
import { abvFromGravity, apparentAttenuation, totalGrainKg, weightedEbc } from './brew';
import { nowIso } from './uuid';

/** 配方实绩档案 */
export interface RecipeArchive {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  recipe: Recipe;
  maltCatalog: MaltCatalog[];
  hopCatalog: HopCatalog[];
  recipeMalts: RecipeMalt[];
  hopUsages: HopUsage[];
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

/** 汇总某个配方的实绩档案 */
export async function buildRecipeArchive(recipeId: string): Promise<RecipeArchive> {
  const recipe = await db.recipes.get(recipeId);
  if (!recipe) throw new Error('配方不存在，无法导出档案');
  const [allMaltCatalog, allHopCatalog, recipeMalts, hopUsages, mashSteps, boilAdds, ferments, packagings] =
    await Promise.all([
      db.maltCatalog.toArray(),
      db.hopCatalog.toArray(),
      db.recipeMalts.where('recipeId').equals(recipeId).toArray(),
      db.hopUsages.where('recipeId').equals(recipeId).toArray(),
      db.mashSteps.where('recipeId').equals(recipeId).toArray(),
      db.boilAdds.where('recipeId').equals(recipeId).toArray(),
      db.ferments.where('recipeId').equals(recipeId).toArray(),
      db.packagings.where('recipeId').equals(recipeId).toArray()
    ]);
  // 档案只带上该配方实际用到的主档；色度以主档现值为准
  const usedMaltIds = new Set(recipeMalts.map((item) => item.maltId));
  const usedHopIds = new Set(hopUsages.map((item) => item.hopId));
  const maltCatalog = allMaltCatalog.filter((item) => usedMaltIds.has(item.id));
  const hopCatalog = allHopCatalog.filter((item) => usedHopIds.has(item.id));
  const sortedFerments = [...ferments].sort((a, b) => a.date.localeCompare(b.date));
  const og = sortedFerments.length > 0 ? sortedFerments[0].gravity : recipe.targetOg;
  const fg = sortedFerments.length > 0 ? sortedFerments[sortedFerments.length - 1].gravity : recipe.targetFg;
  const avgEbc = weightedEbc(
    recipeMalts
      .map((usage) => ({
        ebc: maltCatalog.find((catalog) => catalog.id === usage.maltId)?.ebc ?? 0,
        ratioPct: usage.ratioPct
      }))
      .filter((item) => item.ebc > 0)
  );

  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    recipe: stripRevision(recipe),
    maltCatalog: maltCatalog.map(stripRevision),
    hopCatalog: hopCatalog.map(stripRevision),
    recipeMalts: recipeMalts.map(stripRevision),
    hopUsages: hopUsages.map(stripRevision),
    mashSteps: mashSteps.map(stripRevision),
    boilAdds: boilAdds.map(stripRevision),
    ferments: sortedFerments.map(stripRevision),
    packagings: packagings.map(stripRevision),
    summary: {
      maltCount: recipeMalts.length,
      hopCount: hopUsages.length,
      mashStepCount: mashSteps.length,
      boilAddCount: boilAdds.length,
      fermentCount: ferments.length,
      grainKg: totalGrainKg(recipe.batchSizeL, recipe.targetOg),
      avgEbc,
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
  if (!Array.isArray(candidate.maltCatalog)) throw new Error('maltCatalog 必须是数组');
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
