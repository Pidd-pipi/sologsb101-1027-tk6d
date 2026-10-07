/**
 * 首次打开应用时灌入的演示数据
 * 只在 recipes 表为空时执行。配方 → 主档 / 配方用料 / 糖化步 / 煮沸投加 → 发酵读数 → 罐装批次
 * 三层互相引用，保证 6 个页面第一次进入都有内容。函数本身幂等：由调用方判定表是否为空。
 */
import type {
  RecipeRow,
  MaltCatalogRow,
  HopCatalogRow,
  RecipeMaltRow,
  HopUsageRow,
  MashStepRow,
  BoilAddRow,
  FermentRow,
  PackagingRow
} from './db';
import { db, ROW_REVISION } from './db';

function rev<T>(row: T): T & { revision: number; createdAt: number; updatedAt: number } {
  const now = Date.now();
  return { ...row, revision: ROW_REVISION, createdAt: now, updatedAt: now };
}

const RECIPES: Array<Omit<RecipeRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'rc-001', name: '云顶西海岸 IPA', style: 'IPA', targetOg: 1.062, targetFg: 1.012, targetIbu: 62, targetEbc: 14, batchSizeL: 20 },
  { id: 'rc-002', name: '小麦白啤 Hefe', style: '小麦', targetOg: 1.05, targetFg: 1.011, targetIbu: 18, targetEbc: 8, batchSizeL: 25 },
  { id: 'rc-003', name: '燕麦世涛', style: '世涛', targetOg: 1.068, targetFg: 1.018, targetIbu: 38, targetEbc: 58, batchSizeL: 18 }
];

/** 麦芽主档：色度唯一出处 */
const MALT_CATALOG: Array<Omit<MaltCatalogRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'mc-001', name: '皮尔森麦芽', ebc: 4, origin: '德国', type: '基础麦芽' },
  { id: 'mc-002', name: '慕尼黑麦芽', ebc: 22, origin: '德国', type: '特种麦芽' },
  { id: 'mc-003', name: '焦香水晶麦芽', ebc: 60, origin: '英国', type: '烤制麦芽' },
  { id: 'mc-004', name: '小麦麦芽', ebc: 5, origin: '德国', type: '基础麦芽' },
  { id: 'mc-005', name: '马里斯奥特麦芽', ebc: 6, origin: '英国', type: '基础麦芽' },
  { id: 'mc-006', name: '烘烤大麦', ebc: 1200, origin: '英国', type: '烤制麦芽' }
];

/** 酒花主档：α 酸唯一出处 */
const HOP_CATALOG: Array<Omit<HopCatalogRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'hc-001', name: 'Centennial', alphaPct: 10.5, origin: '美国', form: '颗粒' },
  { id: 'hc-002', name: 'Citra', alphaPct: 12.8, origin: '美国', form: '颗粒' },
  { id: 'hc-003', name: 'Hallertau', alphaPct: 4.2, origin: '德国', form: '整花' },
  { id: 'hc-004', name: 'East Kent Goldings', alphaPct: 5.6, origin: '英国', form: '颗粒' }
];

/** 配方麦芽：只记用量，色度认主档 */
const RECIPE_MALTS: Array<Omit<RecipeMaltRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'rm-001', recipeId: 'rc-001', maltId: 'mc-001', name: '皮尔森麦芽', ratioPct: 82, stale: false },
  { id: 'rm-002', recipeId: 'rc-001', maltId: 'mc-002', name: '慕尼黑麦芽', ratioPct: 12, stale: false },
  { id: 'rm-003', recipeId: 'rc-001', maltId: 'mc-003', name: '焦香水晶麦芽', ratioPct: 6, stale: false },
  { id: 'rm-004', recipeId: 'rc-002', maltId: 'mc-004', name: '小麦麦芽', ratioPct: 55, stale: false },
  { id: 'rm-005', recipeId: 'rc-002', maltId: 'mc-001', name: '皮尔森麦芽', ratioPct: 45, stale: false },
  { id: 'rm-006', recipeId: 'rc-003', maltId: 'mc-005', name: '马里斯奥特麦芽', ratioPct: 70, stale: false },
  { id: 'rm-007', recipeId: 'rc-003', maltId: 'mc-006', name: '烘烤大麦', ratioPct: 10, stale: false }
];

/** 配方酒花：只记用量，α 酸认主档 */
const HOP_USAGES: Array<Omit<HopUsageRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'hu-001', recipeId: 'rc-001', hopId: 'hc-001', name: 'Centennial', amountG: 40, stale: false },
  { id: 'hu-002', recipeId: 'rc-001', hopId: 'hc-002', name: 'Citra', amountG: 30, stale: false },
  { id: 'hu-003', recipeId: 'rc-002', hopId: 'hc-003', name: 'Hallertau', amountG: 25, stale: false },
  { id: 'hu-004', recipeId: 'rc-003', hopId: 'hc-004', name: 'East Kent Goldings', amountG: 45, stale: false }
];

const MASH_STEPS: Array<Omit<MashStepRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'ms-001', recipeId: 'rc-001', seq: 1, tempC: 52, minutes: 15, waterL: 14, state: '已完成' },
  { id: 'ms-002', recipeId: 'rc-001', seq: 2, tempC: 66, minutes: 60, waterL: 16, state: '已完成' },
  { id: 'ms-003', recipeId: 'rc-001', seq: 3, tempC: 76, minutes: 10, waterL: 18, state: '已完成' },
  { id: 'ms-004', recipeId: 'rc-002', seq: 1, tempC: 45, minutes: 20, waterL: 15, state: '已完成' },
  { id: 'ms-005', recipeId: 'rc-002', seq: 2, tempC: 67, minutes: 50, waterL: 18, state: '进行中' },
  { id: 'ms-006', recipeId: 'rc-003', seq: 1, tempC: 68, minutes: 75, waterL: 20, state: '未开始' }
];

/** 煮沸投加：酒花认主档 hopId；澄清辅料 hopId 为 null */
const BOIL_ADDS: Array<Omit<BoilAddRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'ba-001', recipeId: 'rc-001', atMin: 60, material: 'Centennial', hopId: 'hc-001', amountG: 25, purpose: '苦味', stale: false },
  { id: 'ba-002', recipeId: 'rc-001', atMin: 15, material: 'Centennial', hopId: 'hc-001', amountG: 15, purpose: '风味', stale: false },
  { id: 'ba-003', recipeId: 'rc-001', atMin: 5, material: 'Citra', hopId: 'hc-002', amountG: 30, purpose: '香气', stale: false },
  { id: 'ba-004', recipeId: 'rc-002', atMin: 60, material: 'Hallertau', hopId: 'hc-003', amountG: 15, purpose: '苦味', stale: false },
  { id: 'ba-005', recipeId: 'rc-002', atMin: 10, material: 'Hallertau', hopId: 'hc-003', amountG: 10, purpose: '香气', stale: false },
  { id: 'ba-006', recipeId: 'rc-003', atMin: 60, material: 'East Kent Goldings', hopId: 'hc-004', amountG: 30, purpose: '苦味', stale: false },
  { id: 'ba-007', recipeId: 'rc-003', atMin: 15, material: '爱尔兰苔藓', hopId: null, amountG: 5, purpose: '澄清', stale: false }
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

/** 灌入演示数据（配方 → 主档 / 配方用料 / 糖化步 / 煮沸投加 → 发酵读数 → 罐装批次） */
export async function seedDatabase(): Promise<void> {
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
      await db.recipes.bulkPut(RECIPES.map(rev));
      await db.maltCatalog.bulkPut(MALT_CATALOG.map(rev));
      await db.hopCatalog.bulkPut(HOP_CATALOG.map(rev));
      await db.recipeMalts.bulkPut(RECIPE_MALTS.map(rev));
      await db.hopUsages.bulkPut(HOP_USAGES.map(rev));
      await db.mashSteps.bulkPut(MASH_STEPS.map(rev));
      await db.boilAdds.bulkPut(BOIL_ADDS.map(rev));
      await db.ferments.bulkPut(FERMENTS.map(rev));
      await db.packagings.bulkPut(PACKAGINGS.map(rev));
    }
  );
}
