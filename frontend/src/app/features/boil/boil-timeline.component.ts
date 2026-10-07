/**
 * /boil 煮沸投花时间表
 * - 投花认酒花主档 hopId（不再照 material 名字认 α 酸）；按名字认不出主档的旧投加列入「待指认」，人工认领。
 * - 主档 α 酸改动后，引用它的投加标「苦度待重算」，估算 IBU 与 IBU 偏差暂停展示旧值。
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
import { BOIL_PURPOSES, BOIL_TOTAL_MIN, type BoilAdd, type BoilPurpose } from '../../core/models/boil-add.model';
import {
  filtersToQueryParams,
  queryParamsToFilters,
  type FilterModel,
  type FilterSelectConfig
} from '../../core/models/filter.model';
import { BoilActions } from '../../core/state/boil/boil.actions';
import { selectBoilFilter, selectResolvedBoilAdds, selectUnresolvedBoilAdds, type ResolvedBoilAdd } from '../../core/state/boil/boil.selectors';
import { selectAllHopCatalog } from '../../core/state/ingredients/ingredients.selectors';
import { selectAllRecipes, selectSelectedRecipe, selectSelectedRecipeId } from '../../core/state/recipe/recipe.selectors';
import { RecipeActions } from '../../core/state/recipe/recipe.actions';
import { estimateIbu, purposeByAtMin } from '../../core/utils/brew';

interface BoilForm {
  recipeId: string;
  atMin: number;
  kind: 'hop' | 'other';
  hopId: string;
  material: string;
  amountG: number;
  purpose: BoilPurpose;
}

@Component({
  selector: 'app-boil-timeline',
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
          <h2 class="page__title">煮沸投花时间表</h2>
          <p class="page__subtitle">投花认酒花主档取 α 酸；对不上主档的投加列入待指认；α 酸改动后苦度作废重算。</p>
        </div>
        <button mat-flat-button color="primary" type="button" (click)="openCreate()" [disabled]="recipes().length === 0">
          <mat-icon>add</mat-icon>
          新增投加
        </button>
      </div>

      <div class="badge-row">
        <app-stat-badge label="投加条目" [value]="adds().length" suffix="条" tone="primary" icon="add_circle" />
        <app-stat-badge label="估算 IBU 合计" [value]="ibuTotalDisplay()" suffix="IBU" tone="warning" icon="bolt" />
        <app-stat-badge label="目标 IBU" [value]="selectedRecipe()?.targetIbu ?? 0" suffix="IBU" tone="info" icon="flag" />
        <app-stat-badge [label]="ibuDirty() ? 'IBU 偏差（待重算）' : 'IBU 偏差'" [value]="ibuDeltaDisplay()" tone="danger" icon="compare_arrows" />
        <app-stat-badge label="待指认投花" [value]="unresolved().length" suffix="条" tone="danger" icon="help_outline" />
      </div>

      <mat-card appearance="outlined">
        <mat-card-content>
          <div class="boil-recipe">
            <span class="muted">当前配方：</span>
            <mat-form-field appearance="outline" class="boil-recipe__select">
              <mat-label>选择配方</mat-label>
              <mat-select [value]="currentRecipeId()" (selectionChange)="selectRecipe($event.value)">
                @for (recipe of recipes(); track recipe.id) {
                  <mat-option [value]="recipe.id">{{ recipe.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <span class="muted">煮沸总时长 {{ boilTotalMin }} 分钟</span>
          </div>
        </mat-card-content>
      </mat-card>

      @if (unresolved().length > 0) {
        <mat-card appearance="outlined" class="unresolved-card">
          <mat-card-header><mat-card-title>待指认投花（{{ unresolved().length }}）</mat-card-title></mat-card-header>
          <mat-card-content>
            <p class="stale-banner">
              旧数据按名字没认到酒花主档，苦度暂不参与估算；请在每行选一个主档完成指认，非酒花辅料可标记为辅料。
            </p>
            <table class="data-table">
              <thead>
                <tr>
                  <th>所属配方</th>
                  <th>倒计时</th>
                  <th>物料（旧名）</th>
                  <th>用量 g</th>
                  <th>指认酒花主档</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                @for (add of unresolved(); track add.id) {
                  <tr class="stale-row">
                    <td>{{ recipeName(add.recipeId) }}</td>
                    <td>还剩 {{ add.atMin }} 分钟</td>
                    <td>{{ add.material }}</td>
                    <td>{{ add.amountG }}</td>
                    <td>
                      <mat-form-field appearance="outline" class="link-select">
                        <mat-label>选酒花主档</mat-label>
                        <mat-select [value]="linkSelections[add.id] ?? ''" (selectionChange)="setLinkChoice(add.id, $event.value)">
                          @for (hop of hops(); track hop.id) {
                            <mat-option [value]="hop.id">{{ hop.name }}（α {{ hop.alphaPct }}%）</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                    </td>
                    <td>
                      <button
                        mat-flat-button
                        color="primary"
                        type="button"
                        (click)="linkHop(add)"
                        [disabled]="!linkSelections[add.id]"
                      >
                        指认
                      </button>
                      <button mat-button type="button" (click)="markAsOther(add)">标为辅料</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </mat-card-content>
        </mat-card>
      }

      <app-filter-bar
        [filters]="filter()"
        [selects]="selects"
        keywordPlaceholder="搜索物料 / 用途…"
        (filtersChange)="onFilterChange($event)"
        (reset)="onResetFilter()"
      ></app-filter-bar>

      @if (staleAdds().length > 0) {
        <p class="stale-banner">
          酒花主档 α 酸已改动：{{ staleAdds().length }} 条投加的苦度已作废，请按新 α 酸重算后点「已重算」。
        </p>
      }

      @if (adds().length === 0) {
        <app-empty-panel
          title="该配方还没有煮沸投加"
          description="添加 60 分钟苦味投放与 5 分钟香气投放，时间表会自动倒计时排序。"
          createText="新增投加"
          (create)="openCreate()"
        ></app-empty-panel>
      } @else {
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>投加时间表（按倒计时排序）</mat-card-title></mat-card-header>
          <mat-card-content>
            <table class="data-table">
              <thead>
                <tr>
                  <th>倒计时</th>
                  <th>物料</th>
                  <th>用量 g</th>
                  <th>用途</th>
                  <th>α 酸 / 估算 IBU</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                @for (add of adds(); track add.id) {
                  <tr [class.next-row]="add.id === nextAdd()?.id" [class.stale-row]="add.stale">
                    <td>
                      <strong>还剩 {{ add.atMin }} 分钟</strong>
                      @if (add.id === nextAdd()?.id) {
                        <span class="next-flag">下一投加点</span>
                      }
                    </td>
                    <td>
                      {{ add.material }}
                      @if (add.unresolved) {
                        <span class="warn-flag">待指认主档</span>
                      } @else if (add.missing) {
                        <span class="warn-flag">主档已删除</span>
                      } @else if (add.stale) {
                        <span class="stale-flag">苦度待重算</span>
                      }
                    </td>
                    <td>{{ add.amountG }}</td>
                    <td>{{ add.purpose }}<span class="muted">（{{ suggestedPurpose(add) }}）</span></td>
                    <td>
                      @if (add.hop) {
                        <span class="muted">α {{ add.hop.alphaPct }}%</span>
                        @if (add.stale) {
                          <span class="stale-text">旧苦度 {{ ibuOf(add) }} 待重算</span>
                        } @else {
                          <strong>{{ ibuOf(add) }}</strong>
                        }
                      } @else if (add.purpose === '澄清') {
                        <span class="muted">辅料，不计苦度</span>
                      } @else {
                        <span class="warn-text">待指认</span>
                      }
                    </td>
                    <td>
                      @if (add.stale) {
                        <button mat-button type="button" (click)="confirmFresh(add)">已重算</button>
                      }
                      <button mat-button type="button" (click)="edit(add)">编辑</button>
                      <button mat-button color="warn" type="button" (click)="remove(add)">删除</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </mat-card-content>
        </mat-card>
      }

      @if (formVisible) {
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>{{ editingId ? '编辑投加' : '新增投加' }}</mat-card-title></mat-card-header>
          <mat-card-content>
            <div class="form-grid">
              <mat-form-field appearance="outline">
                <mat-label>所属配方</mat-label>
                <mat-select [(ngModel)]="form.recipeId">
                  @for (recipe of recipes(); track recipe.id) {
                    <mat-option [value]="recipe.id">{{ recipe.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>物料类型</mat-label>
                <mat-select [(ngModel)]="form.kind">
                  <mat-option value="hop">酒花（认主档）</mat-option>
                  <mat-option value="other">其他辅料</mat-option>
                </mat-select>
              </mat-form-field>
              @if (form.kind === 'hop') {
                <mat-form-field appearance="outline">
                  <mat-label>酒花主档</mat-label>
                  <mat-select [(ngModel)]="form.hopId">
                    @if (!form.hopId) {
                      <mat-option value="" disabled>请选择酒花主档</mat-option>
                    }
                    @for (hop of hops(); track hop.id) {
                      <mat-option [value]="hop.id">{{ hop.name }}（α {{ hop.alphaPct }}% · {{ hop.form }}）</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              } @else {
                <mat-form-field appearance="outline">
                  <mat-label>物料名称</mat-label>
                  <input matInput [(ngModel)]="form.material" placeholder="如：爱尔兰苔藓" />
                </mat-form-field>
              }              <mat-form-field appearance="outline">
                <mat-label>投加时点（剩余分钟）</mat-label>
                <input matInput type="number" [(ngModel)]="form.atMin" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>用量 g</mat-label>
                <input matInput type="number" [(ngModel)]="form.amountG" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>用途</mat-label>
                <mat-select [(ngModel)]="form.purpose" [disabled]="form.kind === 'other'" >
                  @for (purpose of boilPurposes; track purpose) {
                    <mat-option [value]="purpose">{{ purpose }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            @if (form.kind === 'other') {
              <p class="muted">其他辅料不计酒花苦度，用途固定为「澄清」；若它其实是酒花，请把物料类型改回「酒花（认主档）」并选主档。</p>
            }
          </mat-card-content>
          <mat-card-actions align="end">
            <button mat-button type="button" (click)="formVisible = false">取消</button>
            <button mat-flat-button color="primary" type="button" (click)="submit()">保存</button>
          </mat-card-actions>
        </mat-card>
      }
    </div>
  `,
  styles: [
    `
      .boil-recipe {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .boil-recipe__select {
        width: 260px;
      }
      .link-select {
        width: 220px;
      }
      .next-row {
        background: #fdf6dd;
      }
      .stale-row {
        background: #fdf6dd;
      }
      .next-flag {
        margin-left: 6px;
        background: #d68910;
        color: #fff;
        border-radius: 999px;
        padding: 1px 8px;
        font-size: 11px;
      }
      .stale-flag,
      .warn-flag {
        margin-left: 6px;
        background: #d68910;
        color: #fff;
        border-radius: 999px;
        padding: 1px 8px;
        font-size: 11px;
        white-space: nowrap;
      }
      .warn-flag {
        background: #c0392b;
      }
      .stale-banner {
        background: #fdf6dd;
        border-left: 4px solid #d68910;
        padding: 8px 12px;
        margin: 12px 0;
        font-size: 13px;
      }
      .stale-text,
      .warn-text {
        margin-left: 8px;
        font-size: 12px;
        color: #d68910;
      }
      .warn-text {
        color: #c0392b;
      }
      .unresolved-card {
        border-color: #c0392b;
      }
    `
  ]
})
export class BoilTimelineComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);

  readonly boilPurposes = BOIL_PURPOSES;
  readonly boilTotalMin = BOIL_TOTAL_MIN;
  private readonly allAdds = this.store.selectSignal(selectResolvedBoilAdds);
  readonly unresolved = this.store.selectSignal(selectUnresolvedBoilAdds);
  readonly hops = this.store.selectSignal(selectAllHopCatalog);
  readonly filter = this.store.selectSignal(selectBoilFilter);
  readonly recipes = this.store.selectSignal(selectAllRecipes);
  readonly selectedRecipeId = this.store.selectSignal(selectSelectedRecipeId);
  readonly selectedRecipe = this.store.selectSignal(selectSelectedRecipe);

  /** 待指认行：本行选择的主档候选 */
  linkSelections: Record<string, string | undefined> = {};

  readonly selects: FilterSelectConfig[] = [
    { key: 'purposes', label: '用途', options: BOIL_PURPOSES.map((purpose) => ({ label: purpose, value: purpose })) }
  ];

  readonly currentRecipeId = computed(() => this.selectedRecipeId() ?? this.recipes()[0]?.id ?? '');

  readonly adds = computed(() => {
    const recipeId = this.currentRecipeId();
    const filter = this.filter();
    const keyword = String(filter['keyword'] ?? '').trim().toLowerCase();
    const purposes = Array.isArray(filter['purposes']) ? (filter['purposes'] as string[]) : [];
    return this.allAdds()
      .filter((add) => add.recipeId === recipeId)
      .filter((add) => {
        const label = `${add.material} ${add.purpose}`.toLowerCase();
        if (keyword && !label.includes(keyword)) return false;
        if (purposes.length > 0 && !purposes.includes(add.purpose)) return false;
        return true;
      })
      .sort((a, b) => b.atMin - a.atMin);
  });

  readonly staleAdds = computed(() => this.adds().filter((add) => add.stale));
  readonly nextAdd = computed(() => this.adds().find((add) => add.atMin > 0) ?? null);

  /** 只统计认到主档且不需要重算的行；有待处理时合计不可信 */
  readonly ibuSum = computed(() =>
    Number(this.adds().reduce((sum, add) => sum + (add.hop && !add.stale ? this.ibuOf(add) : 0), 0).toFixed(1))
  );
  readonly ibuDirty = computed(
    () =>
      this.adds().some((add) => add.stale || add.unresolved || add.missing) || this.unresolved().length > 0
  );

  readonly ibuDelta = computed(() => {
    const target = this.selectedRecipe()?.targetIbu ?? 0;
    return Number((this.ibuSum() - target).toFixed(1));
  });

  formVisible = false;
  editingId: string | null = null;
  form: BoilForm = {
    recipeId: '',
    atMin: 60,
    kind: 'hop',
    hopId: '',
    material: '',
    amountG: 20,
    purpose: '苦味'
  };

  ngOnInit(): void {
    this.store.dispatch(RecipeActions.reloadAll());
    const params: Record<string, string | undefined> = {};
    this.route.snapshot.queryParamMap.keys.forEach((key) => {
      params[key] = this.route.snapshot.queryParamMap.get(key) ?? undefined;
    });
    this.store.dispatch(BoilActions.setFilter({ filter: queryParamsToFilters(params, ['purposes']) }));
  }

  ibuTotalDisplay(): string | number {
    return this.ibuDirty() ? '待重算' : this.ibuSum();
  }

  ibuDeltaDisplay(): string | number {
    if (this.ibuDirty()) return '待重算';
    const delta = this.ibuDelta();
    return delta > 0 ? `+${delta}` : delta;
  }

  selectRecipe(recipeId: string): void {
    this.store.dispatch(RecipeActions.selectRecipe({ id: recipeId }));
  }

  recipeName(recipeId: string): string {
    return this.recipes().find((item) => item.id === recipeId)?.name ?? '配方已删除';
  }

  suggestedPurpose(add: ResolvedBoilAdd): string {
    return purposeByAtMin(add.atMin);
  }

  ibuOf(add: ResolvedBoilAdd): number {
    const recipe = this.selectedRecipe();
    const alpha = add.hop?.alphaPct ?? 0;
    return estimateIbu(alpha, add.amountG, add.atMin, recipe?.batchSizeL ?? 20, recipe?.targetOg ?? 1.055);
  }

  setLinkChoice(addId: string, hopId: string): void {
    this.linkSelections = { ...this.linkSelections, [addId]: hopId };
  }

  /** 人工指认：旧名投花落到酒花主档，苦度即时恢复 */
  linkHop(add: ResolvedBoilAdd): void {
    const hopId = this.linkSelections[add.id];
    if (!hopId) return;
    this.store.dispatch(BoilActions.linkBoilAddHop({ id: add.id, hopId }));
    this.snack.open('已指认酒花主档，苦度按其 α 酸重算', '关闭', { duration: 2500 });
  }

  /** 该投加不是酒花（澄清辅料等）：hopId 置 null 且用途改澄清，移出待指认 */
  markAsOther(add: ResolvedBoilAdd): void {
    this.store.dispatch(BoilActions.updateBoilAdd({ id: add.id, patch: { hopId: null, purpose: '澄清', stale: false } }));
  }

  confirmFresh(add: ResolvedBoilAdd): void {
    this.store.dispatch(BoilActions.markBoilAddFresh({ id: add.id }));
    this.snack.open('该行苦度已按新 α 酸重算', '关闭', { duration: 2000 });
  }

  private blankForm(recipeId: string): BoilForm {
    return {
      recipeId,
      atMin: 60,
      kind: 'hop',
      hopId: this.hops()[0]?.id ?? '',
      material: '',
      amountG: 20,
      purpose: '苦味'
    };
  }

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm(this.currentRecipeId());
    this.formVisible = true;
  }

  edit(add: ResolvedBoilAdd): void {
    this.editingId = add.id;
    const isHop = add.hopId !== null || add.purpose !== '澄清';
    this.form = {
      recipeId: add.recipeId,
      atMin: add.atMin,
      kind: isHop ? 'hop' : 'other',
      hopId: add.hopId ?? '',
      material: add.material,
      amountG: add.amountG,
      purpose: add.purpose
    };
    this.formVisible = true;
  }

  submit(): void {
    if (!this.form.recipeId) {
      this.snack.open('请选择配方', '关闭', { duration: 2000 });
      return;
    }
    let payload: Omit<BoilAdd, 'id'>;
    if (this.form.kind === 'hop') {
      const hop = this.hops().find((item) => item.id === this.form.hopId);
      if (!hop) {
        this.snack.open('请选择酒花主档（没有可先到辅料库登记）', '关闭', { duration: 2500 });
        return;
      }
      payload = {
        recipeId: this.form.recipeId,
        atMin: this.form.atMin,
        material: hop.name,
        hopId: hop.id,
        amountG: this.form.amountG,
        purpose: this.form.purpose,
        stale: false
      };
    } else {
      if (!this.form.material.trim()) {
        this.snack.open('请填写辅料名称', '关闭', { duration: 2000 });
        return;
      }
      payload = {
        recipeId: this.form.recipeId,
        atMin: this.form.atMin,
        material: this.form.material.trim(),
        hopId: null,
        amountG: this.form.amountG,
        // 非酒花辅料不计苦度，用途统一记澄清，避免混入「待指认投花」
        purpose: '澄清',
        stale: false
      };
    }

    if (this.editingId) {
      this.store.dispatch(BoilActions.updateBoilAdd({ id: this.editingId, patch: payload }));
    } else {
      this.store.dispatch(BoilActions.createBoilAdd({ payload }));
    }
    this.formVisible = false;
  }

  remove(add: ResolvedBoilAdd): void {
    if (!window.confirm(`删除「${add.material}」在剩余 ${add.atMin} 分钟的投加？`)) return;
    this.store.dispatch(BoilActions.deleteBoilAdd({ id: add.id }));
  }

  onFilterChange(next: FilterModel): void {
    this.store.dispatch(BoilActions.setFilter({ filter: next }));
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filtersToQueryParams(next),
      replaceUrl: true
    });
  }

  onResetFilter(): void {
    this.store.dispatch(BoilActions.resetFilter());
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }
}
