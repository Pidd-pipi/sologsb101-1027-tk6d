/**
 * 首次打开应用时灌入的演示数据（v2 结构）
 * 只在 recipes 表为空时执行。
 * 主档（麦芽 / 酒花）独立维护；配方麦芽投料行按 maltId 引用主档并带色度快照；
 * 煮沸投花按 hopId 认酒花主档并带 α 酸 / IBU 快照。函数幂等：由调用方判定表是否为空。
 */
import type {
  RecipeRow,
  MaltRow,
  HopRow,
  RecipeMaltRow,
  MashStepRow,
  BoilAddRow,
  FermentRow,
  PackagingRow
} from './db';
import { db, ROW_REVISION } from './db';
import { boilAddIbu, weightedEbcFromRefs } from './derived';

function rev<T>(row: T): T & { revision: number; createdAt: number; updatedAt: number } {
  const now = Date.now();
  return { ...row, revision: ROW_REVISION, createdAt: now, updatedAt: now };
}

/* ------------------------------- 配方 ------------------------------- */
const RECIPES_BASE: Array<{
  id: string;
  name: string;
  style: RecipeRow['style'];
  targetOg: number;
  targetFg: number;
  targetIbu: number;
  targetEbc: number;
  batchSizeL: number;
}> = [
  { id: 'rc-001', name: '云顶西海岸 IPA', style: 'IPA', targetOg: 1.062, targetFg: 1.012, targetIbu: 62, targetEbc: 14, batchSizeL: 20 },
  { id: 'rc-002', name: '小麦白啤 Hefe', style: '小麦', targetOg: 1.05, targetFg: 1.011, targetIbu: 18, targetEbc: 8, batchSizeL: 25 },
  { id: 'rc-003', name: '燕麦世涛', style: '世涛', targetOg: 1.068, targetFg: 1.018, targetIbu: 38, targetEbc: 58, batchSizeL: 18 }
];

/* ------------------------------ 麦芽主档 ----------------------------- */
const MALTS: Array<Omit<MaltRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'mt-001', name: '皮尔森麦芽', ebc: 4, origin: '德国', type: '基础麦芽' },
  { id: 'mt-002', name: '慕尼黑麦芽', ebc: 22, origin: '德国', type: '特种麦芽' },
  { id: 'mt-003', name: '焦香水晶麦芽', ebc: 60, origin: '英国', type: '烤制麦芽' },
  { id: 'mt-004', name: '小麦麦芽', ebc: 5, origin: '德国', type: '基础麦芽' },
  { id: 'mt-005', name: '马里斯奥特麦芽', ebc: 6, origin: '英国', type: '基础麦芽' },
  { id: 'mt-006', name: '烘烤大麦', ebc: 1200, origin: '英国', type: '烤制麦芽' }
];

/* ---------------------------- 配方麦芽投料 --------------------------- */
const RECIPE_MALT_INPUT: Array<Omit<RecipeMaltRow, 'nameSnapshot' | 'ebcSnapshot' | 'ebcStale' | 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'rm-001', recipeId: 'rc-001', maltId: 'mt-001', ratioPct: 82 },
  { id: 'rm-002', recipeId: 'rc-001', maltId: 'mt-002', ratioPct: 12 },
  { id: 'rm-003', recipeId: 'rc-001', maltId: 'mt-003', ratioPct: 6 },
  { id: 'rm-004', recipeId: 'rc-002', maltId: 'mt-004', ratioPct: 55 },
  { id: 'rm-005', recipeId: 'rc-002', maltId: 'mt-001', ratioPct: 45 },
  { id: 'rm-006', recipeId: 'rc-003', maltId: 'mt-005', ratioPct: 70 },
  { id: 'rm-007', recipeId: 'rc-003', maltId: 'mt-006', ratioPct: 10 }
];

/* ------------------------------ 酒花主档 ----------------------------- */
const HOPS: Array<Omit<HopRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'hp-001', name: 'Centennial', alphaPct: 10.5, origin: '美国', form: '颗粒' },
  { id: 'hp-002', name: 'Citra', alphaPct: 12.8, origin: '美国', form: '颗粒' },
  { id: 'hp-003', name: 'Hallertau', alphaPct: 4.2, origin: '德国', form: '整花' },
  { id: 'hp-004', name: 'East Kent Goldings', alphaPct: 5.6, origin: '英国', form: '颗粒' }
];

const MASH_STEPS: Array<Omit<MashStepRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'ms-001', recipeId: 'rc-001', seq: 1, tempC: 52, minutes: 15, waterL: 14, state: '已完成' },
  { id: 'ms-002', recipeId: 'rc-001', seq: 2, tempC: 66, minutes: 60, waterL: 16, state: '已完成' },
  { id: 'ms-003', recipeId: 'rc-001', seq: 3, tempC: 76, minutes: 10, waterL: 18, state: '已完成' },
  { id: 'ms-004', recipeId: 'rc-002', seq: 1, tempC: 45, minutes: 20, waterL: 15, state: '已完成' },
  { id: 'ms-005', recipeId: 'rc-002', seq: 2, tempC: 67, minutes: 50, waterL: 18, state: '进行中' },
  { id: 'ms-006', recipeId: 'rc-003', seq: 1, tempC: 68, minutes: 75, waterL: 20, state: '未开始' }
];

/** 投花输入：hopId 认主档；澄清辅料 nonHop */
const BOIL_ADD_INPUT: Array<{
  id: string;
  recipeId: string;
  atMin: number;
  hopId: string | null;
  nonHop?: boolean;
  material?: string;
  amountG: number;
  purpose: BoilAddRow['purpose'];
}> = [
  { id: 'ba-001', recipeId: 'rc-001', atMin: 60, hopId: 'hp-001', amountG: 25, purpose: '苦味' },
  { id: 'ba-002', recipeId: 'rc-001', atMin: 15, hopId: 'hp-001', amountG: 15, purpose: '风味' },
  { id: 'ba-003', recipeId: 'rc-001', atMin: 5, hopId: 'hp-002', amountG: 30, purpose: '香气' },
  { id: 'ba-004', recipeId: 'rc-002', atMin: 60, hopId: 'hp-003', amountG: 15, purpose: '苦味' },
  { id: 'ba-005', recipeId: 'rc-002', atMin: 10, hopId: 'hp-003', amountG: 10, purpose: '香气' },
  { id: 'ba-006', recipeId: 'rc-003', atMin: 60, hopId: 'hp-004', amountG: 30, purpose: '苦味' },
  { id: 'ba-007', recipeId: 'rc-003', atMin: 15, hopId: null, nonHop: true, material: '爱尔兰苔藓', amountG: 5, purpose: '澄清' }
];

const FERMENTS: Array<Omit<FermentRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'fm-001', batchNo: 'B-2401', recipeId: 'rc-001', date: '2024-04-06', gravity: 1.062, tempC: 19.5, diacetylPpm: 0.62, state: '主发酵' },
  { id: 'fm-002', batchNo: 'B-2401', recipeId: 'rc-001', date: '2024-04-10', gravity: 1.028, tempC: 21.4, diacetylPpm: 0.38, state: '主发酵' },
  { id: 'fm-003', batchNo: 'B-2401', recipeId: 'rc-001', date: '2024-04-14', gravity: 1.014, tempC: 25.6, diacetylPpm: 0.16, state: '双乙酰还原' },
  { id: 'fm-004', batchNo: 'B-2401', recipeId: 'rc-001', date: '2024-04-18', gravity: 1.011, tempC: 22.1, diacetylPpm: 0.05, state: '已结束' },
  { id: 'fm-005', batchNo: 'B-2402', recipeId: 'rc-002', date: '2024-04-12', gravity: 1.05, tempC: 18.2, diacetylPpm: 0.5, state: '主发酵' },
  { id: 'fm-006', batchNo: 'B-2402', recipeId: 'rc-002', date: '2024-04-17', gravity: 1.016, tempC: 20.8, diacetylPpm: 0.22, state: '双乙酰还原' },
  { id: 'fm-007', batchNo: 'B-2403', recipeId: 'rc-003', date: '2024-04-20', gravity: 1.068, tempC: 18.8, diacetylPpm: 0.7, state: '主发酵' }
];

const PACKAGINGS: Array<Omit<PackagingRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'pk-001', batchNo: 'B-2401', recipeId: 'rc-001', packDate: '2024-04-22', container: '瓶装', quantity: 40, carbonationVol: 2.5, abv: 6.7 },
  { id: 'pk-002', batchNo: 'B-2402', recipeId: 'rc-002', packDate: '2024-04-24', container: '桶装', quantity: 1, carbonationVol: 2.8, abv: 5.1 },
  { id: 'pk-003', batchNo: 'B-2403', recipeId: 'rc-003', packDate: '2024-05-02', container: '罐装', quantity: 48, carbonationVol: 2.2, abv: 6.6 }
];

/** 灌入演示数据（主档 → 配方 / 投料 / 投花 → 发酵读数 → 罐装批次） */
export async function seedDatabase(): Promise<void> {
  const maltById = new Map(MALTS.map((item) => [item.id, item]));
  const hopById = new Map(HOPS.map((item) => [item.id, item]));
  const recipeById = new Map(RECIPES_BASE.map((item) => [item.id, item]));

  // 配方麦芽投料：从主档取名称 / 色度快照
  const recipeMalts: Array<Omit<RecipeMaltRow, 'revision' | 'createdAt' | 'updatedAt'>> = RECIPE_MALT_INPUT.map((item) => {
    const master = maltById.get(item.maltId);
    return {
      ...item,
      nameSnapshot: master?.name ?? '',
      ebcSnapshot: master?.ebc ?? 0,
      ebcStale: false
    };
  });

  // 配方：按投料行算出色度缓存
  const refsByRecipe = new Map<string, Array<{ ebcSnapshot: number; ratioPct: number }>>();
  for (const ref of recipeMalts) {
    const list = refsByRecipe.get(ref.recipeId) ?? [];
    list.push({ ebcSnapshot: ref.ebcSnapshot, ratioPct: ref.ratioPct });
    refsByRecipe.set(ref.recipeId, list);
  }
  const recipes: Array<Omit<RecipeRow, 'revision' | 'createdAt' | 'updatedAt'>> = RECIPES_BASE.map((item) => ({
    ...item,
    ebcSnapshot: weightedEbcFromRefs(refsByRecipe.get(item.id) ?? []),
    ebcStale: false
  }));

  // 煮沸投加：认主档，写 α 酸 / IBU 快照
  const boilAdds: Array<Omit<BoilAddRow, 'revision' | 'createdAt' | 'updatedAt'>> = BOIL_ADD_INPUT.map((item) => {
    const hop = item.hopId ? hopById.get(item.hopId) : undefined;
    const recipe = recipeById.get(item.recipeId);
    if (!hop || item.nonHop) {
      return {
        id: item.id,
        recipeId: item.recipeId,
        atMin: item.atMin,
        material: item.material ?? '',
        amountG: item.amountG,
        purpose: item.purpose,
        hopId: null,
        nonHop: true,
        alphaSnapshot: 0,
        ibuSnapshot: 0,
        ibuStale: false
      };
    }
    return {
      id: item.id,
      recipeId: item.recipeId,
      atMin: item.atMin,
      material: hop.name,
      amountG: item.amountG,
      purpose: item.purpose,
      hopId: hop.id,
      nonHop: false,
      alphaSnapshot: hop.alphaPct,
      ibuSnapshot: boilAddIbu(
        hop.alphaPct,
        { amountG: item.amountG, atMin: item.atMin },
        { batchSizeL: recipe?.batchSizeL ?? 20, targetOg: recipe?.targetOg ?? 1.055 }
      ),
      ibuStale: false
    };
  });

  await db.transaction(
    'rw',
    [db.recipes, db.malts, db.hops, db.recipeMalts, db.mashSteps, db.boilAdds, db.ferments, db.packagings],
    async () => {
      await db.recipes.bulkPut(recipes.map(rev));
      await db.malts.bulkPut(MALTS.map(rev));
      await db.hops.bulkPut(HOPS.map(rev));
      await db.recipeMalts.bulkPut(recipeMalts.map(rev));
      await db.mashSteps.bulkPut(MASH_STEPS.map(rev));
      await db.boilAdds.bulkPut(boilAdds.map(rev));
      await db.ferments.bulkPut(FERMENTS.map(rev));
      await db.packagings.bulkPut(PACKAGINGS.map(rev));
    }
  );
}
