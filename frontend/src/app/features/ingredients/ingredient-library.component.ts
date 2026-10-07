/**
 * /ingredients 麦芽与酒花辅料库
 * 主档（麦芽 / 酒花入库登记）与配方用料（用量行）分开维护：
 * - 色度 / α 酸只在主档上改；一改，引用它的配方用料与投花立刻标「待重算」，旧偏差 / 旧苦度作废。
 * - 删除主档时若仍被配方用料或投花引用，服务层拦截并弹条提示。
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
import {
  createEmptyHopCatalog,
  createEmptyHopUsage,
  HOP_FORMS,
  type HopCatalog
} from '../../core/models/hop.model';
import {
  createEmptyMaltCatalog,
  createEmptyRecipeMalt,
  MALT_TYPES,
  type MaltCatalog
} from '../../core/models/malt.model';
import { filtersToQueryParams, queryParamsToFilters, type FilterModel, type FilterSelectConfig } from '../../core/models/filter.model';
import { RecipeActions } from '../../core/state/recipe/recipe.actions';
import {
  selectAllHopCatalog,
  selectAllMaltCatalog,
  selectFilteredHopCatalog,
  selectFilteredMaltCatalog,
  selectIngredientsFilter,
  selectResolvedHopUsages,
  selectResolvedRecipeMalts,
  type ResolvedHopUsage,
  type ResolvedRecipeMalt
} from '../../core/state/ingredients/ingredients.selectors';
import { IngredientsActions } from '../../core/state/ingredients/ingredients.actions';
import { selectAllRecipes, selectSelectedRecipeId } from '../../core/state/recipe/recipe.selectors';
import { ebcColor as brewEbcColor, totalGrainKg, weightedEbc } from '../../core/utils/brew';

type FormKind = 'maltCatalog' | 'hopCatalog' | 'recipeMalt' | 'hopUsage';

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
            色度 / α 酸以主档为唯一出处：主档一改，配方色度偏差与煮沸苦度立即作废，行内标出待重算。
          </p>
        </div>
        <div>
          <button mat-stroked-button type="button" (click)="openMaltCatalog()">+ 麦芽主档</button>
          <button mat-stroked-button type="button" (click)="openHopCatalog()">+ 酒花主档</button>
          <button mat-stroked-button type="button" (click)="openRecipeMalt()" [disabled]="!currentRecipeId()">+ 配方麦芽</button>
          <button mat-flat-button color="primary" type="button" (click)="openHopUsage()" [disabled]="!currentRecipeId()">
            + 配方酒花
          </button>
        </div>
      </div>

      <div class="badge-row">
        <app-stat-badge label="麦芽主档" [value]="allMaltCatalog().length" suffix="条" tone="primary" icon="grass" />
        <app-stat-badge label="酒花主档" [value]="allHopCatalog().length" suffix="条" tone="warning" icon="local_florist" />
        <app-stat-badge label="加权平均色度" [value]="avgEbc()" suffix="EBC" tone="info" icon="palette" />
        <app-stat-badge label="总投料量" [value]="grainKg()" suffix="kg" tone="success" icon="scale" />
        <app-stat-badge label="酒花用量合计" [value]="hopGram()" suffix="g" tone="danger" icon="bolt" />
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
            @if (staleMaltCount() > 0) {
              <span class="stale-flag">色度待重算 {{ staleMaltCount() }} 条</span>
            }
            @if (staleHopCount() > 0) {
              <span class="stale-flag">苦度待重算 {{ staleHopCount() }} 条</span>
            }
          </div>
        </mat-card-content>
      </mat-card>

      <app-filter-bar
        [filters]="filter()"
        [selects]="selects"
        keywordPlaceholder="搜索麦芽 / 酒花 / 产地…"
        (filtersChange)="onFilterChange($event)"
        (reset)="onResetFilter()"
      ></app-filter-bar>

      @if (maltCatalog().length === 0 && hopCatalog().length === 0) {
        <app-empty-panel
          title="辅料库还是空的"
          description="先登记麦芽与酒花主档（色度 / α 酸的唯一出处），再把它们按用量加进配方。"
          createText="新增麦芽主档"
          (create)="openMaltCatalog()"
        ></app-empty-panel>
      }

      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>麦芽主档（{{ allMaltCatalog().length }}）· 色度唯一出处</mat-card-title></mat-card-header>
        <mat-card-content>
          <table class="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>色度 EBC</th>
                <th>产地</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              @for (malt of maltCatalog(); track malt.id) {
                <tr>
                  <td>{{ malt.name }}</td>
                  <td>{{ malt.type }}</td>
                  <td>
                    <span class="swatch" [style.background]="ebcColor(malt.ebc)"></span>
                    {{ malt.ebc }}
                  </td>
                  <td>{{ malt.origin }}</td>
                  <td>
                    <button mat-button type="button" (click)="editMaltCatalog(malt)">编辑</button>
                    <button mat-button color="warn" type="button" (click)="removeMaltCatalog(malt)">删除</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>酒花主档（{{ allHopCatalog().length }}）· α 酸唯一出处</mat-card-title></mat-card-header>
        <mat-card-content>
          <table class="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>形态</th>
                <th>α 酸 %</th>
                <th>产地</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              @for (hop of hopCatalog(); track hop.id) {
                <tr>
                  <td>{{ hop.name }}</td>
                  <td>{{ hop.form }}</td>
                  <td>{{ hop.alphaPct }}</td>
                  <td>{{ hop.origin }}</td>
                  <td>
                    <button mat-button type="button" (click)="editHopCatalog(hop)">编辑</button>
                    <button mat-button color="warn" type="button" (click)="removeHopCatalog(hop)">删除</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined">
        <mat-card-header>
          <mat-card-title>当前配方的麦芽用量（{{ recipeMalts().length }}）</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          @if (staleMaltCount() > 0) {
            <p class="stale-banner">主档色度已改动：以下配方的色度偏差已作废，请按新色度重算后点「已重算」消除标记。</p>
          }
          <table class="data-table">
            <thead>
              <tr>
                <th>麦芽主档</th>
                <th>主档色度 EBC</th>
                <th>占比 %</th>
                <th>投料量 kg</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              @for (malt of recipeMalts(); track malt.id) {
                <tr [class.stale-row]="malt.stale || malt.missing">
                  <td>{{ malt.name }}</td>
                  <td>
                    @if (malt.ebc !== null) {
                      <span class="swatch" [style.background]="ebcColor(malt.ebc)"></span>{{ malt.ebc }}
                    } @else {
                      <span class="missing-flag">主档缺失</span>
                    }
                  </td>
                  <td>{{ malt.ratioPct }}</td>
                  <td>{{ maltKg(malt) }}</td>
                  <td>
                    @if (malt.stale) {
                      <span class="stale-flag">色度待重算</span>
                    } @else {
                      <span class="muted">已同步</span>
                    }
                  </td>
                  <td>
                    @if (malt.stale) {
                      <button mat-button type="button" (click)="confirmMaltFresh(malt)">已重算</button>
                    }
                    <button mat-button type="button" (click)="editRecipeMalt(malt)">编辑</button>
                    <button mat-button color="warn" type="button" (click)="removeRecipeMalt(malt)">移除</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined">
        <mat-card-header>
          <mat-card-title>当前配方的酒花用量（{{ recipeHops().length }}）</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          @if (staleHopCount() > 0) {
            <p class="stale-banner">主档 α 酸已改动：引用它的煮沸苦度已作废，请按新 α 酸重算后点「已重算」消除标记。</p>
          }
          <table class="data-table">
            <thead>
              <tr>
                <th>酒花主档</th>
                <th>主档 α 酸 %</th>
                <th>用量 g</th>
                <th>用途倾向</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              @for (hop of recipeHops(); track hop.id) {
                <tr [class.stale-row]="hop.stale || hop.missing">
                  <td>{{ hop.name }}</td>
                  <td>
                    @if (hop.alphaPct !== null) {
                      {{ hop.alphaPct }}
                    } @else {
                      <span class="missing-flag">主档缺失</span>
                    }
                  </td>
                  <td>{{ hop.amountG }}</td>
                  <td>{{ (hop.alphaPct ?? 0) >= 10 ? '苦味 / 双用' : '香气' }}</td>
                  <td>
                    @if (hop.stale) {
                      <span class="stale-flag">苦度待重算</span>
                    } @else {
                      <span class="muted">已同步</span>
                    }
                  </td>
                  <td>
                    @if (hop.stale) {
                      <button mat-button type="button" (click)="confirmHopFresh(hop)">已重算</button>
                    }
                    <button mat-button type="button" (click)="editHopUsage(hop)">编辑</button>
                    <button mat-button color="warn" type="button" (click)="removeHopUsage(hop)">移除</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </mat-card-content>
      </mat-card>

      @if (formVisible) {
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>{{ formTitle() }}</mat-card-title></mat-card-header>
          <mat-card-content>
            <div class="form-grid">
              @switch (formKind) {
                @case ('maltCatalog') {
                  <mat-form-field appearance="outline">
                    <mat-label>名称</mat-label>
                    <input matInput [(ngModel)]="maltCatalogForm.name" />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>色度 EBC</mat-label>
                    <input matInput type="number" [(ngModel)]="maltCatalogForm.ebc" />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>产地</mat-label>
                    <input matInput [(ngModel)]="maltCatalogForm.origin" />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>类型</mat-label>
                    <mat-select [(ngModel)]="maltCatalogForm.type">
                      @for (type of maltTypes; track type) {
                        <mat-option [value]="type">{{ type }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                }
                @case ('hopCatalog') {
                  <mat-form-field appearance="outline">
                    <mat-label>名称</mat-label>
                    <input matInput [(ngModel)]="hopCatalogForm.name" />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>α 酸 %</mat-label>
                    <input matInput type="number" step="0.1" [(ngModel)]="hopCatalogForm.alphaPct" />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>产地</mat-label>
                    <input matInput [(ngModel)]="hopCatalogForm.origin" />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>形态</mat-label>
                    <mat-select [(ngModel)]="hopCatalogForm.form">
                      @for (form of hopForms; track form) {
                        <mat-option [value]="form">{{ form }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                }
                @case ('recipeMalt') {
                  <mat-form-field appearance="outline">
                    <mat-label>选择麦芽主档</mat-label>
                    <mat-select [(ngModel)]="recipeMaltForm.maltId">
                      @if (!recipeMaltForm.maltId) {
                        <mat-option value="" disabled>请先登记并选择麦芽主档</mat-option>
                      }
                      @for (malt of allMaltCatalog(); track malt.id) {
                        <mat-option [value]="malt.id">{{ malt.name }}（{{ malt.ebc }} EBC）</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>用量占比 %</mat-label>
                    <input matInput type="number" [(ngModel)]="recipeMaltForm.ratioPct" />
                  </mat-form-field>
                }
                @case ('hopUsage') {
                  <mat-form-field appearance="outline">
                    <mat-label>选择酒花主档</mat-label>
                    <mat-select [(ngModel)]="hopUsageForm.hopId">
                      @if (!hopUsageForm.hopId) {
                        <mat-option value="" disabled>请先登记并选择酒花主档</mat-option>
                      }
                      @for (hop of allHopCatalog(); track hop.id) {
                        <mat-option [value]="hop.id">{{ hop.name }}（α {{ hop.alphaPct }}%）</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>用量 g</mat-label>
                    <input matInput type="number" [(ngModel)]="hopUsageForm.amountG" />
                  </mat-form-field>
                }
              }
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
      .swatch {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 3px;
        margin-right: 6px;
        vertical-align: middle;
        border: 1px solid #ddd;
      }
      .boil-recipe {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .boil-recipe__select {
        width: 260px;
      }
      .stale-row {
        background: #fdf6dd;
      }
      .stale-flag {
        background: #d68910;
        color: #fff;
        border-radius: 999px;
        padding: 2px 10px;
        font-size: 12px;
        white-space: nowrap;
      }
      .stale-banner {
        background: #fdf6dd;
        border-left: 4px solid #d68910;
        padding: 8px 12px;
        margin: 0 0 10px;
        font-size: 13px;
      }
      .missing-flag {
        color: #c0392b;
        font-size: 12px;
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

  readonly allMaltCatalog = this.store.selectSignal(selectAllMaltCatalog);
  readonly allHopCatalog = this.store.selectSignal(selectAllHopCatalog);
  readonly maltCatalog = this.store.selectSignal(selectFilteredMaltCatalog);
  readonly hopCatalog = this.store.selectSignal(selectFilteredHopCatalog);
  private readonly allRecipeMalts = this.store.selectSignal(selectResolvedRecipeMalts);
  private readonly allHopUsages = this.store.selectSignal(selectResolvedHopUsages);
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

  readonly currentRecipeId = computed(() => this.selectedRecipeId() ?? this.recipes()[0]?.id ?? '');

  private readonly keyword = computed(() => String(this.filter()['keyword'] ?? '').trim().toLowerCase());

  readonly recipeMalts = computed<ResolvedRecipeMalt[]>(() => {
    const recipeId = this.currentRecipeId();
    const keyword = this.keyword();
    return this.allRecipeMalts()
      .filter((item) => item.recipeId === recipeId)
      .filter((item) => !keyword || `${item.name} ${item.origin} ${item.type}`.toLowerCase().includes(keyword));
  });

  readonly recipeHops = computed<ResolvedHopUsage[]>(() => {
    const recipeId = this.currentRecipeId();
    const keyword = this.keyword();
    return this.allHopUsages()
      .filter((item) => item.recipeId === recipeId)
      .filter((item) => !keyword || `${item.name} ${item.origin} ${item.form}`.toLowerCase().includes(keyword));
  });

  readonly staleMaltCount = computed(() => this.recipeMalts().filter((item) => item.stale).length);
  readonly staleHopCount = computed(() => this.recipeHops().filter((item) => item.stale).length);

  readonly avgEbc = computed(() => {
    const list = this.recipeMalts().filter((item) => item.ebc !== null);
    return list.length === 0 ? 0 : weightedEbc(list.map((item) => ({ ebc: item.ebc as number, ratioPct: item.ratioPct })));
  });

  readonly grainKg = computed(() => {
    const recipe = this.recipes().find((item) => item.id === this.currentRecipeId());
    if (!recipe) return 0;
    return totalGrainKg(recipe.batchSizeL, recipe.targetOg);
  });

  readonly hopGram = computed(() => this.recipeHops().reduce((sum, item) => sum + item.amountG, 0));

  formVisible = false;
  formKind: FormKind = 'maltCatalog';
  editingId: string | null = null;
  maltCatalogForm: Omit<MaltCatalog, 'id'> = createEmptyMaltCatalog();
  hopCatalogForm: Omit<HopCatalog, 'id'> = createEmptyHopCatalog();
  recipeMaltForm = { maltId: '', ratioPct: 80 };
  hopUsageForm = { hopId: '', amountG: 30 };

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

  formTitle(): string {
    const action = this.editingId ? '编辑' : '新增';
    switch (this.formKind) {
      case 'maltCatalog':
        return `${action}麦芽主档`;
      case 'hopCatalog':
        return `${action}酒花主档`;
      case 'recipeMalt':
        return `${action}配方麦芽`;
      default:
        return `${action}配方酒花`;
    }
  }

  selectRecipe(recipeId: string): void {
    this.store.dispatch(RecipeActions.selectRecipe({ id: recipeId }));
  }

  ebcColor(ebc: number): string {
    return brewEbcColor(ebc);
  }

  maltKg(malt: ResolvedRecipeMalt): number {
    return Number(((this.grainKg() * malt.ratioPct) / 100).toFixed(2));
  }

  /* ----------------------------- 麦芽主档 ----------------------------- */

  openMaltCatalog(): void {
    this.formKind = 'maltCatalog';
    this.editingId = null;
    this.maltCatalogForm = createEmptyMaltCatalog();
    this.formVisible = true;
  }

  editMaltCatalog(malt: MaltCatalog & { id: string }): void {
    this.formKind = 'maltCatalog';
    this.editingId = malt.id;
    this.maltCatalogForm = { name: malt.name, ebc: malt.ebc, origin: malt.origin, type: malt.type };
    this.formVisible = true;
  }

  removeMaltCatalog(malt: { id: string; name: string }): void {
    if (!window.confirm(`删除麦芽主档「${malt.name}」？仍被配方引用时会被拦下。`)) return;
    this.store.dispatch(IngredientsActions.deleteMaltCatalog({ id: malt.id }));
  }

  /* ----------------------------- 酒花主档 ----------------------------- */

  openHopCatalog(): void {
    this.formKind = 'hopCatalog';
    this.editingId = null;
    this.hopCatalogForm = createEmptyHopCatalog();
    this.formVisible = true;
  }

  editHopCatalog(hop: HopCatalog & { id: string }): void {
    this.formKind = 'hopCatalog';
    this.editingId = hop.id;
    this.hopCatalogForm = { name: hop.name, alphaPct: hop.alphaPct, origin: hop.origin, form: hop.form };
    this.formVisible = true;
  }

  removeHopCatalog(hop: { id: string; name: string }): void {
    if (!window.confirm(`删除酒花主档「${hop.name}」？仍被配方用料或煮沸投加引用时会被拦下。`)) return;
    this.store.dispatch(IngredientsActions.deleteHopCatalog({ id: hop.id }));
  }

  /* ----------------------------- 配方麦芽 ----------------------------- */

  openRecipeMalt(): void {
    this.formKind = 'recipeMalt';
    this.editingId = null;
    this.recipeMaltForm = { maltId: this.allMaltCatalog()[0]?.id ?? '', ratioPct: 80 };
    this.formVisible = true;
  }

  editRecipeMalt(malt: ResolvedRecipeMalt): void {
    this.formKind = 'recipeMalt';
    this.editingId = malt.id;
    this.recipeMaltForm = { maltId: malt.maltId, ratioPct: malt.ratioPct };
    this.formVisible = true;
  }

  removeRecipeMalt(malt: ResolvedRecipeMalt): void {
    if (!window.confirm(`从当前配方移除麦芽「${malt.name}」？`)) return;
    this.store.dispatch(IngredientsActions.deleteRecipeMalt({ id: malt.id }));
  }

  confirmMaltFresh(malt: ResolvedRecipeMalt): void {
    this.store.dispatch(IngredientsActions.markRecipeMaltFresh({ id: malt.id }));
    this.snack.open('色度偏差已按主档新值重算', '关闭', { duration: 2200 });
  }

  /* ----------------------------- 配方酒花 ----------------------------- */

  openHopUsage(): void {
    this.formKind = 'hopUsage';
    this.editingId = null;
    this.hopUsageForm = { hopId: this.allHopCatalog()[0]?.id ?? '', amountG: 30 };
    this.formVisible = true;
  }

  editHopUsage(hop: ResolvedHopUsage): void {
    this.formKind = 'hopUsage';
    this.editingId = hop.id;
    this.hopUsageForm = { hopId: hop.hopId, amountG: hop.amountG };
    this.formVisible = true;
  }

  removeHopUsage(hop: ResolvedHopUsage): void {
    if (!window.confirm(`从当前配方移除酒花「${hop.name}」？`)) return;
    this.store.dispatch(IngredientsActions.deleteHopUsage({ id: hop.id }));
  }

  confirmHopFresh(hop: ResolvedHopUsage): void {
    this.store.dispatch(IngredientsActions.markHopUsageFresh({ id: hop.id }));
    this.snack.open('煮沸苦度已按主档新 α 酸重算', '关闭', { duration: 2200 });
  }

  /* ------------------------------- 提交 ------------------------------- */

  submit(): void {
    switch (this.formKind) {
      case 'maltCatalog':
        this.submitMaltCatalog();
        break;
      case 'hopCatalog':
        this.submitHopCatalog();
        break;
      case 'recipeMalt':
        this.submitRecipeMalt();
        break;
      default:
        this.submitHopUsage();
    }
  }

  private submitMaltCatalog(): void {
    if (!this.maltCatalogForm.name.trim()) {
      this.snack.open('请填写麦芽名称', '关闭', { duration: 2200 });
      return;
    }
    if (this.editingId) {
      this.store.dispatch(IngredientsActions.updateMaltCatalog({ id: this.editingId, patch: { ...this.maltCatalogForm } }));
    } else {
      this.store.dispatch(IngredientsActions.createMaltCatalog({ payload: { ...this.maltCatalogForm } }));
    }
    this.formVisible = false;
  }

  private submitHopCatalog(): void {
    if (!this.hopCatalogForm.name.trim()) {
      this.snack.open('请填写酒花名称', '关闭', { duration: 2200 });
      return;
    }
    if (this.editingId) {
      this.store.dispatch(IngredientsActions.updateHopCatalog({ id: this.editingId, patch: { ...this.hopCatalogForm } }));
    } else {
      this.store.dispatch(IngredientsActions.createHopCatalog({ payload: { ...this.hopCatalogForm } }));
    }
    this.formVisible = false;
  }

  private submitRecipeMalt(): void {
    const catalog = this.allMaltCatalog().find((item) => item.id === this.recipeMaltForm.maltId);
    if (!catalog) {
      this.snack.open('请先登记麦芽主档再加入配方', '关闭', { duration: 2500 });
      return;
    }
    const payload = {
      ...createEmptyRecipeMalt(),
      recipeId: this.currentRecipeId(),
      maltId: catalog.id,
      name: catalog.name,
      ratioPct: this.recipeMaltForm.ratioPct,
      stale: false
    };
    if (this.editingId) {
      this.store.dispatch(IngredientsActions.updateRecipeMalt({ id: this.editingId, patch: payload }));
    } else {
      this.store.dispatch(IngredientsActions.createRecipeMalt({ payload }));
    }
    this.formVisible = false;
  }

  private submitHopUsage(): void {
    const catalog = this.allHopCatalog().find((item) => item.id === this.hopUsageForm.hopId);
    if (!catalog) {
      this.snack.open('请先登记酒花主档再加入配方', '关闭', { duration: 2500 });
      return;
    }
    const payload = {
      ...createEmptyHopUsage(),
      recipeId: this.currentRecipeId(),
      hopId: catalog.id,
      name: catalog.name,
      amountG: this.hopUsageForm.amountG,
      stale: false
    };
    if (this.editingId) {
      this.store.dispatch(IngredientsActions.updateHopUsage({ id: this.editingId, patch: payload }));
    } else {
      this.store.dispatch(IngredientsActions.createHopUsage({ payload }));
    }
    this.formVisible = false;
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
