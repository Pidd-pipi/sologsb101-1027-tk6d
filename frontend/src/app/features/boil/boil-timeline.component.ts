/**
 * /boil 煮沸投花时间表
 * - 投花认酒花主档：hopId 指向辅料库酒花主档，不再照 material 名字认；
 * - 旧数据里认不出主档的投加列入「待指认」，等人逐条认到主档或标记为非酒花辅料；
 * - IBU 读投加苦度快照；主档 α 酸一改，快照标「待重算」，确认重算前旧值不作数。
 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
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
import {
  BOIL_PURPOSES,
  BOIL_TOTAL_MIN,
  createEmptyBoilAdd,
  isUnresolvedBoilAdd,
  type BoilAdd,
  type BoilPurpose
} from '../../core/models/boil-add.model';
import { filtersToQueryParams, queryParamsToFilters, type FilterModel, type FilterSelectConfig } from '../../core/models/filter.model';
import { BoilActions } from '../../core/state/boil/boil.actions';
import {
  selectAllBoilAdds,
  selectBoilFilter,
  selectStaleIbuAddIds,
  selectUnresolvedBoilAdds,
  selectUnresolvedBoilCount
} from '../../core/state/boil/boil.selectors';
import { selectAllHops } from '../../core/state/ingredients/ingredients.selectors';
import { selectAllRecipes, selectSelectedRecipe, selectSelectedRecipeId } from '../../core/state/recipe/recipe.selectors';
import { RecipeActions } from '../../core/state/recipe/recipe.actions';
import { purposeByAtMin } from '../../core/utils/brew';

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
          <p class="page__subtitle">投花认酒花主档（按 id 不再照名字认）；α 酸调整后苦度标「待重算」，确认后才刷新 IBU。</p>
        </div>
        <button mat-flat-button color="primary" type="button" (click)="openCreate()" [disabled]="recipes().length === 0">
          <mat-icon>add</mat-icon>
          新增投加
        </button>
      </div>

      <div class="badge-row">
        <app-stat-badge label="投加条目" [value]="adds().length" suffix="条" tone="primary" icon="add_circle" />
        <app-stat-badge label="估算 IBU 合计" [value]="totalIbu()" suffix="IBU" tone="warning" icon="bolt" />
        <app-stat-badge label="目标 IBU" [value]="selectedRecipe()?.targetIbu ?? 0" suffix="IBU" tone="info" icon="flag" />
        <app-stat-badge label="IBU 偏差" [value]="ibuDelta()" tone="danger" icon="compare_arrows" />
        <app-stat-badge label="待指认投花" [value]="unresolvedCount()" suffix="条" tone="danger" icon="help" />
      </div>

      <mat-card appearance="outlined">
        <mat-card-content>
          <div class="boil-recipe">
            <span class="muted">当前配方：</span>
            <mat-form-field appearance="outline" class="boil-recipe__select">
              <mat-label>选择配方</mat-label>
              <mat-select [value]="activeRecipeId()" (selectionChange)="selectRecipe($event.value)">
                @for (recipe of recipes(); track recipe.id) {
                  <mat-option [value]="recipe.id">{{ recipe.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <span class="muted">煮沸总时长 {{ boilTotalMin }} 分钟</span>
            @if (staleCount() > 0) {
              <span class="stale-flag">{{ staleCount() }} 条苦度待重算</span>
              <button mat-stroked-button color="warn" type="button" (click)="recomputeStale()">重算本配方</button>
            }
          </div>
        </mat-card-content>
      </mat-card>

      <!-- 待指认投花：旧数据照名字认不到主档，等人指认 -->
      @if (unresolved().length > 0) {
        <mat-card appearance="outlined" class="unresolved-card">
          <mat-card-header>
            <mat-card-title>待指认投花（{{ unresolved().length }}）</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p class="muted">以下投加的物料名认不到酒花主档，请认到主档；若为澄清剂等辅料可直接标为非酒花。</p>
            <table class="data-table">
              <thead>
                <tr>
                  <th>倒计时</th>
                  <th>登记物料名</th>
                  <th>用量 g</th>
                  <th>用途</th>
                  <th>认到酒花主档</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                @for (add of unresolved(); track add.id) {
                  <tr>
                    <td>还剩 {{ add.atMin }} 分钟</td>
                    <td><strong>{{ add.material || '（无名）' }}</strong></td>
                    <td>{{ add.amountG }}</td>
                    <td>{{ add.purpose }}</td>
                    <td>
                      <mat-form-field appearance="outline" class="resolve-select">
                        <mat-select [value]="resolution(add.id)" (selectionChange)="setResolution(add.id, $event.value)">
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
                        [disabled]="!resolution(add.id)"
                        (click)="confirmResolve(add)"
                      >
                        确认指认
                      </button>
                      <button mat-button type="button" (click)="markNonHop(add)">标为非酒花辅料</button>
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

      @if (adds().length === 0) {
        <app-empty-panel
          title="该配方还没有已确认的煮沸投加"
          description="投花直接选择酒花主档；上方待指认列表里的旧投加认到主档后会进入时间表。"
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
                  <th>物料 / 酒花主档</th>
                  <th>用量 g</th>
                  <th>用途</th>
                  <th>α 酸快照</th>
                  <th>估算 IBU</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                @for (add of adds(); track add.id) {
                  <tr [class.next-row]="add.id === nextAdd()?.id">
                    <td>
                      <strong>还剩 {{ add.atMin }} 分钟</strong>
                      @if (add.id === nextAdd()?.id) {
                        <span class="next-flag">下一投加点</span>
                      }
                    </td>
                    <td>
                      {{ add.material }}
                      @if (add.nonHop) {
                        <span class="nonhop-tag">非酒花</span>
                      }
                    </td>
                    <td>{{ add.amountG }}</td>
                    <td>{{ add.purpose }}<span class="muted">（{{ suggestedPurpose(add) }}）</span></td>
                    <td>{{ add.nonHop ? '—' : add.alphaSnapshot + '%' }}</td>
                    <td>
                      @if (add.nonHop) {
                        <span class="muted">不计</span>
                      } @else if (add.ibuStale) {
                        <span class="stale-tag">待重算</span>
                        <span class="muted">旧值 {{ add.ibuSnapshot }}</span>
                        <button mat-button color="warn" type="button" (click)="recomputeOne(add)">重算</button>
                      } @else {
                        {{ add.ibuSnapshot }}
                      }
                    </td>
                    <td>
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
        <mat-card appearance="outlined" class="inline-form">
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
                <mat-label>投加时点（剩余分钟）</mat-label>
                <input matInput type="number" [(ngModel)]="form.atMin" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>类型</mat-label>
                <mat-select [(ngModel)]="formKind" (selectionChange)="onKindChange($event.value)">
                  <mat-option value="hop">投花（选酒花主档）</mat-option>
                  <mat-option value="nonHop">非酒花辅料（澄清剂等）</mat-option>
                </mat-select>
              </mat-form-field>
              @if (formKind === 'hop') {
                <mat-form-field appearance="outline">
                  <mat-label>酒花主档</mat-label>
                  <mat-select [(ngModel)]="form.hopId">
                    @for (hop of hops(); track hop.id) {
                      <mat-option [value]="hop.id">{{ hop.name }}（α {{ hop.alphaPct }}%）</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              } @else {
                <mat-form-field appearance="outline">
                  <mat-label>辅料名称</mat-label>
                  <input matInput [(ngModel)]="form.material" placeholder="如：爱尔兰苔藓" />
                </mat-form-field>
              }
              <mat-form-field appearance="outline">
                <mat-label>用量 g</mat-label>
                <input matInput type="number" [(ngModel)]="form.amountG" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>用途</mat-label>
                <mat-select [(ngModel)]="form.purpose">
                  @for (purpose of boilPurposes; track purpose) {
                    <mat-option [value]="purpose">{{ purpose }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
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
        flex-wrap: wrap;
      }
      .boil-recipe__select {
        width: 260px;
      }
      .next-row {
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
      .nonhop-tag {
        margin-left: 6px;
        background: #eef3ea;
        color: #3f6b3a;
        border: 1px solid #cfe0c6;
        border-radius: 999px;
        padding: 1px 8px;
        font-size: 11px;
      }
      .stale-tag {
        background: #fdecea;
        color: #c0392b;
        border: 1px solid #e6b0aa;
        border-radius: 999px;
        padding: 1px 8px;
        font-size: 11px;
        margin-right: 4px;
      }
      .stale-flag {
        background: #c0392b;
        color: #fff;
        border-radius: 999px;
        padding: 2px 10px;
        font-size: 12px;
      }
      .unresolved-card {
        margin-top: 12px;
        border-color: #e6b0aa;
      }
      .resolve-select {
        width: 220px;
      }
      .inline-form {
        margin-top: 14px;
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
  readonly allAdds = this.store.selectSignal(selectAllBoilAdds);
  readonly hops = this.store.selectSignal(selectAllHops);
  readonly filter = this.store.selectSignal(selectBoilFilter);
  readonly recipes = this.store.selectSignal(selectAllRecipes);
  readonly selectedRecipeId = this.store.selectSignal(selectSelectedRecipeId);
  readonly selectedRecipe = this.store.selectSignal(selectSelectedRecipe);
  readonly unresolvedCountAll = this.store.selectSignal(selectUnresolvedBoilCount);
  readonly staleIbuIds = this.store.selectSignal(selectStaleIbuAddIds);

  /** 待指认下拉的临时选择（不立即落库，确认才指认） */
  private readonly resolutions = signal<Record<string, string>>({});

  readonly selects: FilterSelectConfig[] = [
    { key: 'purposes', label: '用途', options: BOIL_PURPOSES.map((purpose) => ({ label: purpose, value: purpose })) }
  ];

  /** 页面实际使用的配方（未显式选择时取第一个） */
  readonly activeRecipeId = computed(() => this.selectedRecipeId() ?? this.recipes()[0]?.id ?? '');
  private readonly activeRecipe = computed(() => this.recipes().find((item) => item.id === this.activeRecipeId()) ?? null);

  readonly unresolvedCount = computed(() => this.unresolvedCountAll());

  readonly unresolved = this.store.selectSignal(
    // 待指认跨配方展示：旧数据认不到主档的投花全部列出等人指认
    selectUnresolvedBoilAdds()
  );

  readonly adds = computed(() => {
    const recipeId = this.activeRecipeId();
    const filter = this.filter();
    const keyword = String(filter['keyword'] ?? '').trim().toLowerCase();
    const purposes = Array.isArray(filter['purposes']) ? (filter['purposes'] as string[]) : [];
    return this.allAdds()
      .filter((add) => add.recipeId === recipeId)
      // 认不到主档的待指认投花统一在上方「待指认」面板处理，不进时间表与 IBU 合计
      .filter((add) => !isUnresolvedBoilAdd(add))
      .filter((add) => {
        const label = `${add.material} ${add.purpose}`.toLowerCase();
        if (keyword && !label.includes(keyword)) return false;
        if (purposes.length > 0 && !purposes.includes(add.purpose)) return false;
        return true;
      })
      .sort((a, b) => b.atMin - a.atMin);
  });

  readonly nextAdd = computed(() => this.adds().find((add) => add.atMin > 0 && !isUnresolvedBoilAdd(add)) ?? null);

  /** IBU 合计只读快照；待指认 / 非酒花不计 */
  readonly totalIbu = computed(() =>
    Number(
      this.adds()
        .filter((add) => !add.nonHop && add.hopId !== null)
        .reduce((sum, add) => sum + add.ibuSnapshot, 0)
        .toFixed(1)
    )
  );

  readonly ibuDelta = computed(() => {
    const target = this.activeRecipe()?.targetIbu ?? 0;
    return Number((this.totalIbu() - target).toFixed(1));
  });

  readonly staleCount = computed(() => this.adds().filter((add) => add.ibuStale).length);

  formVisible = false;
  editingId: string | null = null;
  form: Omit<BoilAdd, 'id'> = createEmptyBoilAdd();
  /** 表单类型：投花 / 非酒花辅料 */
  formKind: 'hop' | 'nonHop' = 'hop';

  ngOnInit(): void {
    this.store.dispatch(RecipeActions.reloadAll());
    const params: Record<string, string | undefined> = {};
    this.route.snapshot.queryParamMap.keys.forEach((key) => {
      params[key] = this.route.snapshot.queryParamMap.get(key) ?? undefined;
    });
    this.store.dispatch(BoilActions.setFilter({ filter: queryParamsToFilters(params, ['purposes']) }));
  }

  selectRecipe(recipeId: string): void {
    this.store.dispatch(RecipeActions.selectRecipe({ id: recipeId }));
  }

  resolution(addId: string): string {
    return this.resolutions()[addId] ?? '';
  }

  setResolution(addId: string, hopId: string): void {
    this.resolutions.update((map) => ({ ...map, [addId]: hopId }));
  }

  suggestedPurpose(add: BoilAdd): string {
    return purposeByAtMin(add.atMin);
  }

  confirmResolve(add: BoilAdd): void {
    const hopId = this.resolutions()[add.id];
    if (!hopId) return;
    this.store.dispatch(BoilActions.resolveBoilHop({ addId: add.id, hopId }));
    this.snack.open('已认到酒花主档并现算苦度', '关闭', { duration: 2500 });
  }

  markNonHop(add: BoilAdd): void {
    if (!window.confirm(`将「${add.material}」标为非酒花辅料（不参与 IBU）？`)) return;
    this.store.dispatch(BoilActions.markBoilNonHop({ addId: add.id }));
  }

  recomputeOne(add: BoilAdd): void {
    this.store.dispatch(BoilActions.recomputeIbu({ addIds: [add.id] }));
    this.snack.open('已按最新 α 酸重算苦度', '关闭', { duration: 2200 });
  }

  recomputeStale(): void {
    const ids = this.adds()
      .filter((add) => add.ibuStale)
      .map((add) => add.id);
    if (ids.length === 0) return;
    this.store.dispatch(BoilActions.recomputeIbu({ addIds: ids }));
    this.snack.open('已按最新 α 酸重算本配方苦度', '关闭', { duration: 2500 });
  }

  onKindChange(kind: 'hop' | 'nonHop'): void {
    this.formKind = kind;
    if (kind === 'nonHop') {
      this.form.hopId = null;
      if (this.form.purpose === '苦味' || this.form.purpose === '风味' || this.form.purpose === '香气') {
        this.form.purpose = '澄清' as BoilPurpose;
      }
    } else {
      this.form.material = '';
      this.form.nonHop = false;
    }
  }

  openCreate(): void {
    this.editingId = null;
    this.form = createEmptyBoilAdd();
    this.form.recipeId = this.activeRecipeId();
    this.formKind = 'hop';
    this.form.hopId = this.hops()[0]?.id ?? null;
    this.formVisible = true;
  }

  edit(add: BoilAdd): void {
    this.editingId = add.id;
    this.form = {
      recipeId: add.recipeId,
      atMin: add.atMin,
      material: add.material,
      amountG: add.amountG,
      purpose: add.purpose,
      hopId: add.hopId,
      nonHop: add.nonHop,
      alphaSnapshot: add.alphaSnapshot,
      ibuSnapshot: add.ibuSnapshot,
      ibuStale: add.ibuStale
    };
    this.formKind = add.nonHop ? 'nonHop' : 'hop';
    this.formVisible = true;
  }

  submit(): void {
    if (!this.form.recipeId) {
      this.snack.open('请选择配方', '关闭', { duration: 2200 });
      return;
    }
    if (this.formKind === 'hop') {
      if (!this.form.hopId) {
        this.snack.open('请选择酒花主档（或改用非酒花辅料）', '关闭', { duration: 2500 });
        return;
      }
      const hop = this.hops().find((item) => item.id === this.form.hopId);
      const payload: Omit<BoilAdd, 'id'> = {
        ...this.form,
        nonHop: false,
        material: hop?.name ?? '',
        alphaSnapshot: hop?.alphaPct ?? 0,
        ibuSnapshot: 0,
        ibuStale: false
      };
      this.dispatchUpsert(payload);
    } else {
      if (!this.form.material.trim()) {
        this.snack.open('请填写辅料名称', '关闭', { duration: 2200 });
        return;
      }
      const payload: Omit<BoilAdd, 'id'> = {
        ...this.form,
        hopId: null,
        nonHop: true,
        alphaSnapshot: 0,
        ibuSnapshot: 0,
        ibuStale: false
      };
      this.dispatchUpsert(payload);
    }
    this.formVisible = false;
  }

  private dispatchUpsert(payload: Omit<BoilAdd, 'id'>): void {
    if (this.editingId) {
      this.store.dispatch(BoilActions.updateBoilAdd({ id: this.editingId, patch: payload }));
    } else {
      this.store.dispatch(BoilActions.createBoilAdd({ payload }));
    }
  }

  remove(add: BoilAdd): void {
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
