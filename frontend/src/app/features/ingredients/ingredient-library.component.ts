/**
 * /ingredients 麦芽与酒花辅料库
 * - 麦芽 / 酒花主档全局维护（色度、α 酸的唯一出处）；
 * - 「当前配方的麦芽配比」按 maltId 引用主档，配比在此、色度取自主档；
 * - 主档色度 / α 酸一改，配方色度与投花苦度立即作废，页面先标「待重算」；
 * - 删除主档前检查引用：仍被配方投料或投花引用则拦住。
 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { FilterBarComponent } from '../../shared/components/filter-bar/filter-bar.component';
import { StatBadgeComponent } from '../../shared/components/stat-badge/stat-badge.component';
import { EmptyPanelComponent } from '../../shared/components/empty-panel/empty-panel.component';
import { createEmptyHop, HOP_FORMS, type Hop } from '../../core/models/hop.model';
import { createEmptyMalt, MALT_TYPES, type Malt } from '../../core/models/malt.model';
import { createEmptyRecipeMalt, type RecipeMalt } from '../../core/models/recipe-malt.model';
import { filtersToQueryParams, queryParamsToFilters, type FilterModel, type FilterSelectConfig } from '../../core/models/filter.model';
import { RecipeActions } from '../../core/state/recipe/recipe.actions';
import {
  selectAllHops,
  selectAllMalts,
  selectAllRecipeMalts,
  selectFilteredHops,
  selectFilteredMalts,
  selectIngredientsFilter
} from '../../core/state/ingredients/ingredients.selectors';
import { IngredientsActions } from '../../core/state/ingredients/ingredients.actions';
import { selectAllBoilAdds } from '../../core/state/boil/boil.selectors';
import { selectAllRecipes, selectSelectedRecipeId } from '../../core/state/recipe/recipe.selectors';
import { ebcColor as brewEbcColor, totalGrainKg } from '../../core/utils/brew';
import { weightedEbcFromRefs } from '../../core/utils/derived';

@Component({
  selector: 'app-ingredient-library',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    FilterBarComponent,
    StatBadgeComponent,
    EmptyPanelComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page__head">
        <div>
          <h2 class="page__title">麦芽与酒花辅料库</h2>
          <p class="page__subtitle">
            主档是色度与 α 酸的唯一出处；调整主档后，配方色度偏差与煮沸苦度会立即标为「待重算」，确认重算前不作数。
          </p>
        </div>
        <div>
          <button mat-stroked-button type="button" (click)="openMalt()">+ 麦芽主档</button>
          <button mat-flat-button color="primary" type="button" (click)="openHop()">+ 酒花主档</button>
        </div>
      </div>

      <div class="badge-row">
        <app-stat-badge label="麦芽主档" [value]="malts().length" suffix="条" tone="primary" icon="grass" />
        <app-stat-badge label="酒花主档" [value]="hops().length" suffix="条" tone="warning" icon="local_florist" />
        <app-stat-badge label="当前配方加权色度" [value]="currentAvgEbc()" suffix="EBC" tone="info" icon="palette" />
        <app-stat-badge label="当前配方总投料" [value]="grainKg()" suffix="kg" tone="success" icon="scale" />
        <app-stat-badge label="投花用量合计" [value]="hopGram()" suffix="g" tone="danger" icon="bolt" />
      </div>

      <app-filter-bar
        [filters]="filter()"
        [selects]="selects"
        keywordPlaceholder="搜索麦芽 / 酒花 / 产地…"
        (filtersChange)="onFilterChange($event)"
        (reset)="onResetFilter()"
      ></app-filter-bar>

      <!-- 当前配方的麦芽配比 -->
      <mat-card appearance="outlined">
        <mat-card-header>
          <mat-card-title>
            当前配方麦芽配比
            <mat-form-field appearance="outline" class="recipe-select">
              <mat-select [value]="selectedRecipeId()" (selectionChange)="selectRecipe($event.value)">
                @for (recipe of recipes(); track recipe.id) {
                  <mat-option [value]="recipe.id">{{ recipe.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            @if (currentRecipe() && currentRecipe().ebcStale) {
              <span class="stale-flag">色度偏差待重算</span>
              <button mat-stroked-button color="warn" type="button" class="recompute-btn" (click)="recomputeCurrentEbc()">
                立即重算
              </button>
            }
          </mat-card-title>
        </mat-card-header>
        <mat-card-content>
          @if (recipeMalts().length === 0) {
            <p class="muted">该配方还没有麦芽投料，从下方选择麦芽主档并设置占比。</p>
          } @else {
            <table class="data-table">
              <thead>
                <tr>
                  <th>麦芽主档</th>
                  <th>类型</th>
                  <th>引用色度 EBC</th>
                  <th>占比 %</th>
                  <th>投料量 kg</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                @for (ref of recipeMalts(); track ref.id) {
                  <tr>
                    <td>{{ ref.nameSnapshot }}</td>
                    <td>{{ maltType(ref.maltId) }}</td>
                    <td>
                      <span class="swatch" [style.background]="ebcColor(ref.ebcSnapshot)"></span>
                      {{ ref.ebcSnapshot }}
                    </td>
                    <td>{{ ref.ratioPct }}</td>
                    <td>{{ recipeMaltKg(ref) }}</td>
                    <td>
                      @if (ref.ebcStale) {
                        <span class="stale-tag">待重算</span>
                      } @else {
                        <span class="muted">最新</span>
                      }
                    </td>
                    <td>
                      <button mat-button type="button" (click)="editRecipeMalt(ref)">改配比</button>
                      <button mat-button color="warn" type="button" (click)="removeRecipeMalt(ref)">移除</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
          <div class="add-ref-row">
            <button mat-flat-button color="primary" type="button" (click)="openRecipeMalt()" [disabled]="malts().length === 0">
              + 从麦芽主档投料
            </button>
          </div>
        </mat-card-content>
      </mat-card>

      @if (malts().length === 0 && hops().length === 0) {
        <app-empty-panel
          title="辅料库还是空的"
          description="先建立麦芽与酒花主档（入库登记名、色度、α 酸），配方与投花统一按主档引用。"
          createText="新增麦芽主档"
          (create)="openMalt()"
        ></app-empty-panel>
      } @else {
        <mat-card appearance="outlined">
          <mat-card-header>
            <mat-card-title>麦芽主档（{{ malts().length }}）· 色度唯一出处</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <table class="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>类型</th>
                  <th>色度 EBC</th>
                  <th>产地</th>
                  <th>引用</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                @for (malt of malts(); track malt.id) {
                  <tr>
                    <td>{{ malt.name }}</td>
                    <td>{{ malt.type }}</td>
                    <td>
                      <span class="swatch" [style.background]="ebcColor(malt.ebc)"></span>
                      {{ malt.ebc }}
                    </td>
                    <td>{{ malt.origin }}</td>
                    <td>{{ maltRefCount(malt.id) }} 条配方</td>
                    <td>
                      <button mat-button type="button" (click)="editMalt(malt)">编辑</button>
                      <button
                        mat-button
                        color="warn"
                        type="button"
                        (click)="removeMalt(malt)"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined">
          <mat-card-header>
            <mat-card-title>酒花主档（{{ hops().length }}）· α 酸唯一出处</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <table class="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>形态</th>
                  <th>α 酸 %</th>
                  <th>产地</th>
                  <th>投花引用</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                @for (hop of hops(); track hop.id) {
                  <tr>
                    <td>{{ hop.name }}</td>
                    <td>{{ hop.form }}</td>
                    <td>{{ hop.alphaPct }}</td>
                    <td>{{ hop.origin }}</td>
                    <td>{{ hopRefCount(hop.id) }} 条投花</td>
                    <td>
                      <button mat-button type="button" (click)="editHop(hop)">编辑</button>
                      <button mat-button color="warn" type="button" (click)="removeHop(hop)">删除</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </mat-card-content>
        </mat-card>
      }

      <!-- 配方麦芽投料表单 -->
      @if (recipeMaltFormVisible) {
        <mat-card appearance="outlined" class="inline-form">
          <mat-card-header>
            <mat-card-title>{{ editingRecipeMaltId ? '调整配方麦芽投料' : '从麦芽主档投料' }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="form-grid">
              <mat-form-field appearance="outline">
                <mat-label>麦芽主档</mat-label>
                <mat-select [(ngModel)]="recipeMaltForm.maltId" [disabled]="editingRecipeMaltId !== null">
                  @for (malt of malts(); track malt.id) {
                    <mat-option [value]="malt.id">{{ malt.name }}（{{ malt.ebc }} EBC）</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>用量占比 %</mat-label>
                <input matInput type="number" [(ngModel)]="recipeMaltForm.ratioPct" />
              </mat-form-field>
            </div>
          </mat-card-content>
          <mat-card-actions align="end">
            <button mat-button type="button" (click)="recipeMaltFormVisible = false">取消</button>
            <button mat-flat-button color="primary" type="button" (click)="submitRecipeMalt()">保存</button>
          </mat-card-actions>
        </mat-card>
      }

      <!-- 麦芽主档表单 -->
      @if (maltFormVisible) {
        <mat-card appearance="outlined" class="inline-form">
          <mat-card-header><mat-card-title>{{ editingMaltId ? '编辑麦芽主档' : '新增麦芽主档' }}</mat-card-title></mat-card-header>
          <mat-card-content>
            <div class="form-grid">
              <mat-form-field appearance="outline">
                <mat-label>名称（入库登记名）</mat-label>
                <input matInput [(ngModel)]="maltForm.name" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>色度 EBC</mat-label>
                <input matInput type="number" [(ngModel)]="maltForm.ebc" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>产地</mat-label>
                <input matInput [(ngModel)]="maltForm.origin" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>类型</mat-label>
                <mat-select [(ngModel)]="maltForm.type">
                  @for (type of maltTypes; track type) {
                    <mat-option [value]="type">{{ type }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
          </mat-card-content>
          <mat-card-actions align="end">
            <button mat-button type="button" (click)="maltFormVisible = false">取消</button>
            <button mat-flat-button color="primary" type="button" (click)="submitMalt()">保存</button>
          </mat-card-actions>
        </mat-card>
      }

      <!-- 酒花主档表单 -->
      @if (hopFormVisible) {
        <mat-card appearance="outlined" class="inline-form">
          <mat-card-header><mat-card-title>{{ editingHopId ? '编辑酒花主档' : '新增酒花主档' }}</mat-card-title></mat-card-header>
          <mat-card-content>
            <div class="form-grid">
              <mat-form-field appearance="outline">
                <mat-label>名称（入库登记名）</mat-label>
                <input matInput [(ngModel)]="hopForm.name" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>α 酸 %</mat-label>
                <input matInput type="number" step="0.1" [(ngModel)]="hopForm.alphaPct" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>产地</mat-label>
                <input matInput [(ngModel)]="hopForm.origin" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>形态</mat-label>
                <mat-select [(ngModel)]="hopForm.form">
                  @for (form of hopForms; track form) {
                    <mat-option [value]="form">{{ form }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
          </mat-card-content>
          <mat-card-actions align="end">
            <button mat-button type="button" (click)="hopFormVisible = false">取消</button>
            <button mat-flat-button color="primary" type="button" (click)="submitHop()">保存</button>
          </mat-card-actions>
        </mat-card>
      }
    </div>
  `,
  styles: [
    `
      .swatch {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 3px;
        margin-right: 6px;
        vertical-align: middle;
        border: 1px solid #ddd;
      }
      .recipe-select {
        width: 240px;
        margin-left: 12px;
      }
      .stale-flag {
        margin-left: 10px;
        background: #c0392b;
        color: #fff;
        border-radius: 999px;
        padding: 2px 10px;
        font-size: 12px;
        vertical-align: middle;
      }
      .recompute-btn {
        margin-left: 8px;
        vertical-align: middle;
      }
      .stale-tag {
        background: #fdecea;
        color: #c0392b;
        border: 1px solid #e6b0aa;
        border-radius: 999px;
        padding: 1px 8px;
        font-size: 11px;
      }
      .add-ref-row {
        margin-top: 10px;
      }
      .inline-form {
        margin-top: 14px;
      }
    `
  ]
})
export class IngredientLibraryComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);

  readonly maltTypes = MALT_TYPES;
  readonly hopForms = HOP_FORMS;

  readonly malts = this.store.selectSignal(selectFilteredMalts);
  readonly allMalts = this.store.selectSignal(selectAllMalts);
  readonly hops = this.store.selectSignal(selectFilteredHops);
  readonly allHops = this.store.selectSignal(selectAllHops);
  readonly allRecipeMalts = this.store.selectSignal(selectAllRecipeMalts);
  readonly allBoilAdds = this.store.selectSignal(selectAllBoilAdds);
  readonly filter = this.store.selectSignal(selectIngredientsFilter);
  readonly recipes = this.store.selectSignal(selectAllRecipes);
  readonly selectedRecipeId = this.store.selectSignal(selectSelectedRecipeId);

  readonly selects: FilterSelectConfig[] = [
    { key: 'types', label: '麦芽类型', options: MALT_TYPES.map((type) => ({ label: type, value: type })) },
    { key: 'forms', label: '酒花形态', options: HOP_FORMS.map((form) => ({ label: form, value: form })) },
    {
      key: 'origins',
      label: '产地',
      options: ['德国', '英国', '美国', '捷克', '新西兰'].map((origin) => ({ label: origin, value: origin }))
    }
  ];

  readonly currentRecipe = computed(
    () => this.recipes().find((item) => item.id === this.selectedRecipeId()) ?? this.recipes()[0] ?? null
  );

  readonly recipeMalts = computed(() => {
    const recipe = this.currentRecipe();
    if (!recipe) return [];
    return this.allRecipeMalts()
      .filter((item) => item.recipeId === recipe.id)
      .sort((a, b) => b.ratioPct - a.ratioPct);
  });

  readonly currentAvgEbc = computed(() =>
    weightedEbcFromRefs(this.recipeMalts().map((item) => ({ ebcSnapshot: item.ebcSnapshot, ratioPct: item.ratioPct })))
  );

  readonly grainKg = computed(() => {
    const recipe = this.currentRecipe();
    return recipe ? totalGrainKg(recipe.batchSizeL, recipe.targetOg) : 0;
  });

  /** 当前配方投花用量合计（煮沸投加认主档后的实际用量） */
  readonly hopGram = computed(() => {
    const recipe = this.currentRecipe();
    if (!recipe) return 0;
    return this.allBoilAdds()
      .filter((item) => item.recipeId === recipe.id && !item.nonHop)
      .reduce((sum, item) => sum + item.amountG, 0);
  });

  maltFormVisible = false;
  hopFormVisible = false;
  recipeMaltFormVisible = false;
  editingMaltId: string | null = null;
  editingHopId: string | null = null;
  editingRecipeMaltId: string | null = null;
  maltForm: Omit<Malt, 'id'> = createEmptyMalt();
  hopForm: Omit<Hop, 'id'> = createEmptyHop();
  recipeMaltForm: { maltId: string; ratioPct: number } = { maltId: '', ratioPct: 80 };

  ngOnInit(): void {
    this.store.dispatch(RecipeActions.reloadAll());
    const params: Record<string, string | undefined> = {};
    this.route.snapshot.queryParamMap.keys.forEach((key) => {
      params[key] = this.route.snapshot.queryParamMap.get(key) ?? undefined;
    });
    this.store.dispatch(
      IngredientsActions.setFilter({ filter: queryParamsToFilters(params, ['types', 'forms', 'origins']) })
    );
  }

  ebcColor(ebc: number): string {
    return brewEbcColor(ebc);
  }

  selectRecipe(recipeId: string): void {
    this.store.dispatch(RecipeActions.selectRecipe({ id: recipeId }));
  }

  maltType(maltId: string): string {
    return this.allMalts().find((item) => item.id === maltId)?.type ?? '主档已删除';
  }

  recipeMaltKg(ref: RecipeMalt): number {
    return Number(((this.grainKg() * ref.ratioPct) / 100).toFixed(2));
  }

  maltRefCount(maltId: string): number {
    return this.allRecipeMalts().filter((item) => item.maltId === maltId).length;
  }

  hopRefCount(hopId: string): number {
    return this.allBoilAdds().filter((item) => item.hopId === hopId).length;
  }

  /* ---------------------------- 配方麦芽投料 ---------------------------- */

  openRecipeMalt(): void {
    this.editingRecipeMaltId = null;
    this.recipeMaltForm = { maltId: this.malts()[0]?.id ?? this.allMalts()[0]?.id ?? '', ratioPct: 20 };
    this.recipeMaltFormVisible = true;
  }

  editRecipeMalt(ref: RecipeMalt): void {
    this.editingRecipeMaltId = ref.id;
    this.recipeMaltForm = { maltId: ref.maltId, ratioPct: ref.ratioPct };
    this.recipeMaltFormVisible = true;
  }

  submitRecipeMalt(): void {
    const recipe = this.currentRecipe();
    if (!recipe) {
      this.snack.open('请先选择配方', '关闭', { duration: 2200 });
      return;
    }
    if (!this.recipeMaltForm.maltId) {
      this.snack.open('请选择麦芽主档', '关闭', { duration: 2200 });
      return;
    }
    if (this.editingRecipeMaltId) {
      this.store.dispatch(
        IngredientsActions.updateRecipeMalt({ id: this.editingRecipeMaltId, patch: { ratioPct: this.recipeMaltForm.ratioPct } })
      );
    } else {
      const master = this.allMalts().find((item) => item.id === this.recipeMaltForm.maltId);
      const payload: Omit<RecipeMalt, 'id'> = {
        recipeId: recipe.id,
        maltId: this.recipeMaltForm.maltId,
        ratioPct: this.recipeMaltForm.ratioPct,
        nameSnapshot: master?.name ?? '',
        ebcSnapshot: master?.ebc ?? 0,
        ebcStale: false
      };
      this.store.dispatch(IngredientsActions.createRecipeMalt({ payload }));
    }
    this.recipeMaltFormVisible = false;
  }

  removeRecipeMalt(ref: RecipeMalt): void {
    if (!window.confirm(`从当前配方移除「${ref.nameSnapshot}」？主档保留，不影响其它配方。`)) return;
    this.store.dispatch(IngredientsActions.deleteRecipeMalt({ id: ref.id }));
  }

  recomputeCurrentEbc(): void {
    const recipe = this.currentRecipe();
    if (!recipe) return;
    this.store.dispatch(IngredientsActions.recomputeEbc({ recipeIds: [recipe.id] }));
    this.snack.open('已按最新主档色度重算配方色度偏差', '关闭', { duration: 2500 });
  }

  /* ------------------------------ 麦芽主档 ------------------------------ */

  openMalt(): void {
    this.editingMaltId = null;
    this.maltForm = createEmptyMalt();
    this.maltFormVisible = true;
  }

  editMalt(malt: Malt): void {
    this.editingMaltId = malt.id;
    this.maltForm = { name: malt.name, ebc: malt.ebc, origin: malt.origin, type: malt.type };
    this.maltFormVisible = true;
  }

  submitMalt(): void {
    if (!this.maltForm.name.trim()) {
      this.snack.open('请填写麦芽名称（入库登记名）', '关闭', { duration: 2500 });
      return;
    }
    if (this.editingMaltId) {
      const before = this.allMalts().find((item) => item.id === this.editingMaltId);
      const ebcChanged = typeof this.maltForm.ebc === 'number' && before?.ebc !== this.maltForm.ebc;
      this.store.dispatch(IngredientsActions.updateMalt({ id: this.editingMaltId, patch: { ...this.maltForm } }));
      if (ebcChanged) {
        const n = this.maltRefCount(this.editingMaltId);
        this.snack.open(
          n > 0 ? `色度已调整，${n} 处配方色度偏差已作废，待重算` : '麦芽主档已保存',
          '关闭',
          { duration: 3000 }
        );
      }
    } else {
      this.store.dispatch(IngredientsActions.createMalt({ payload: { ...this.maltForm } }));
      this.snack.open('麦芽主档已保存', '关闭', { duration: 2000 });
    }
    this.maltFormVisible = false;
  }

  removeMalt(malt: Malt): void {
    const refs = this.maltRefCount(malt.id);
    if (refs > 0) {
      this.snack.open(`「${malt.name}」仍被 ${refs} 条配方投料引用，不能删除`, '知道了', { duration: 3200 });
      return;
    }
    if (!window.confirm(`删除麦芽主档「${malt.name}」？`)) return;
    this.store.dispatch(IngredientsActions.deleteMalt({ id: malt.id }));
  }

  /* ------------------------------ 酒花主档 ------------------------------ */

  openHop(): void {
    this.editingHopId = null;
    this.hopForm = createEmptyHop();
    this.hopFormVisible = true;
  }

  editHop(hop: Hop): void {
    this.editingHopId = hop.id;
    this.hopForm = { name: hop.name, alphaPct: hop.alphaPct, origin: hop.origin, form: hop.form };
    this.hopFormVisible = true;
  }

  submitHop(): void {
    if (!this.hopForm.name.trim()) {
      this.snack.open('请填写酒花名称（入库登记名）', '关闭', { duration: 2500 });
      return;
    }
    if (this.editingHopId) {
      const before = this.allHops().find((item) => item.id === this.editingHopId);
      const alphaChanged = typeof this.hopForm.alphaPct === 'number' && before?.alphaPct !== this.hopForm.alphaPct;
      this.store.dispatch(IngredientsActions.updateHop({ id: this.editingHopId, patch: { ...this.hopForm } }));
      if (alphaChanged) {
        const n = this.hopRefCount(this.editingHopId);
        this.snack.open(
          n > 0 ? `α 酸已调整，${n} 条投花的煮沸苦度已作废，待重算` : '酒花主档已保存',
          '关闭',
          { duration: 3000 }
        );
      }
    } else {
      this.store.dispatch(IngredientsActions.createHop({ payload: { ...this.hopForm } }));
      this.snack.open('酒花主档已保存', '关闭', { duration: 2000 });
    }
    this.hopFormVisible = false;
  }

  removeHop(hop: Hop): void {
    const refs = this.hopRefCount(hop.id);
    if (refs > 0) {
      this.snack.open(`「${hop.name}」仍被 ${refs} 条煮沸投花引用，不能删除`, '知道了', { duration: 3200 });
      return;
    }
    if (!window.confirm(`删除酒花主档「${hop.name}」？`)) return;
    this.store.dispatch(IngredientsActions.deleteHop({ id: hop.id }));
  }

  onFilterChange(next: FilterModel): void {
    this.store.dispatch(IngredientsActions.setFilter({ filter: next }));
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filtersToQueryParams(next),
      replaceUrl: true
    });
  }

  onResetFilter(): void {
    this.store.dispatch(IngredientsActions.resetFilter());
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }
}
