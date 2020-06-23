///
/// Copyright © 2016-2020 The Thingsboard Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

import { Component, forwardRef, Input, OnInit } from '@angular/core';
import { PageComponent } from '@shared/components/page.component';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import {
  DataKey,
  Datasource,
  DatasourceType,
  datasourceTypeTranslationMap,
  defaultLegendConfig,
  GroupInfo,
  JsonSchema,
  widgetType
} from '@shared/models/widget.models';
import {
  ControlValueAccessor,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  Validator,
  Validators
} from '@angular/forms';
import { WidgetConfigComponentData } from '@home/models/widget-component.models';
import { deepClone, isDefined, isObject } from '@app/core/utils';
import { alarmFields, AlarmSearchStatus } from '@shared/models/alarm.models';
import { IAliasController } from '@core/api/widget-api.models';
import { EntityAlias, EntityAliases } from '@shared/models/alias.models';
import { UtilsService } from '@core/services/utils.service';
import { DataKeyType } from '@shared/models/telemetry/telemetry.models';
import { TranslateService } from '@ngx-translate/core';
import { EntityType } from '@shared/models/entity-type.models';
import { forkJoin, Observable, of, Subscription } from 'rxjs';
import { WidgetConfigCallbacks } from '@home/components/widget/widget-config.component.models';
import {
  EntityAliasDialogComponent,
  EntityAliasDialogData
} from '@home/components/alias/entity-alias-dialog.component';
import { catchError, map, mergeMap, tap } from 'rxjs/operators';
import { MatDialog } from '@angular/material/dialog';
import { EntityService } from '@core/http/entity.service';
import { JsonFormComponentData } from '@shared/components/json-form/json-form-component.models';
import { WidgetActionsData } from './action/manage-widget-actions.component.models';
import { DashboardState } from '@shared/models/dashboard.models';
import { entityFields } from '@shared/models/entity.models';

const emptySettingsSchema: JsonSchema = {
  type: 'object',
  properties: {}
};
const emptySettingsGroupInfoes: GroupInfo[] = [];
const defaultSettingsForm = [
  '*'
];

@Component({
  selector: 'tb-widget-config',
  templateUrl: './widget-config.component.html',
  styleUrls: ['./widget-config.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => WidgetConfigComponent),
      multi: true
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => WidgetConfigComponent),
      multi: true,
    }
  ]
})
export class WidgetConfigComponent extends PageComponent implements OnInit, ControlValueAccessor, Validator {

  widgetTypes = widgetType;

  entityTypes = EntityType;

  alarmSearchStatuses = Object.keys(AlarmSearchStatus);

  @Input()
  forceExpandDatasources: boolean;

  @Input()
  aliasController: IAliasController;

  @Input()
  entityAliases: EntityAliases;

  @Input()
  functionsOnly: boolean;

  @Input()
  dashboardStates: {[id: string]: DashboardState };

  @Input() disabled: boolean;

  widgetType: widgetType;

  datasourceType = DatasourceType;
  datasourceTypes: Array<DatasourceType>;
  datasourceTypesTranslations = datasourceTypeTranslationMap;

  widgetConfigCallbacks: WidgetConfigCallbacks = {
    createEntityAlias: this.createEntityAlias.bind(this),
    generateDataKey: this.generateDataKey.bind(this),
    fetchEntityKeys: this.fetchEntityKeys.bind(this),
    fetchDashboardStates: this.fetchDashboardStates.bind(this)
  };

  widgetEditMode = this.utils.widgetEditMode;

  selectedTab: number;

  modelValue: WidgetConfigComponentData;

  private propagateChange = null;

  public dataSettings: FormGroup;
  public targetDeviceSettings: FormGroup;
  public alarmSourceSettings: FormGroup;
  public widgetSettings: FormGroup;
  public layoutSettings: FormGroup;
  public advancedSettings: FormGroup;
  public actionsSettings: FormGroup;

  private dataSettingsChangesSubscription: Subscription;
  private targetDeviceSettingsSubscription: Subscription;
  private alarmSourceSettingsSubscription: Subscription;
  private widgetSettingsSubscription: Subscription;
  private layoutSettingsSubscription: Subscription;
  private advancedSettingsSubscription: Subscription;
  private actionsSettingsSubscription: Subscription;

  constructor(protected store: Store<AppState>,
              private utils: UtilsService,
              private entityService: EntityService,
              private dialog: MatDialog,
              private translate: TranslateService,
              private fb: FormBuilder) {
    super(store);
  }

  ngOnInit(): void {
    if (this.functionsOnly) {
      this.datasourceTypes = [DatasourceType.function];
    } else {
      this.datasourceTypes = [DatasourceType.function, DatasourceType.entity];
    }
    this.dataSettings = this.fb.group({});
    this.targetDeviceSettings = this.fb.group({});
    this.alarmSourceSettings = this.fb.group({});
    this.advancedSettings = this.fb.group({});
    this.widgetSettings = this.fb.group({
      title: [null, []],
      showTitleIcon: [null, []],
      titleIcon: [null, []],
      iconColor: [null, []],
      iconSize: [null, []],
      titleTooltip: [null, []],
      showTitle: [null, []],
      dropShadow: [null, []],
      enableFullscreen: [null, []],
      backgroundColor: [null, []],
      color: [null, []],
      padding: [null, []],
      margin: [null, []],
      widgetStyle: [null, []],
      titleStyle: [null, []],
      units: [null, []],
      decimals: [null, [Validators.min(0), Validators.max(15), Validators.pattern(/^\d*$/)]],
      showLegend: [null, []],
      legendConfig: [null, []]
    });
    this.widgetSettings.get('showTitleIcon').valueChanges.subscribe((value: boolean) => {
      if (value) {
        this.widgetSettings.get('titleIcon').enable({emitEvent: false});
      } else {
        this.widgetSettings.get('titleIcon').disable({emitEvent: false});
      }
    });
    this.widgetSettings.get('showLegend').valueChanges.subscribe((value: boolean) => {
      if (value) {
        this.widgetSettings.get('legendConfig').enable({emitEvent: false});
      } else {
        this.widgetSettings.get('legendConfig').disable({emitEvent: false});
      }
    });
    this.layoutSettings = this.fb.group({
      mobileOrder: [null, [Validators.pattern(/^-?[0-9]+$/)]],
      mobileHeight: [null, [Validators.min(1), Validators.max(10), Validators.pattern(/^\d*$/)]]
    });
    this.actionsSettings = this.fb.group({
      actionsData: [null, []]
    });
  }

  private removeChangeSubscriptions() {
    if (this.dataSettingsChangesSubscription) {
      this.dataSettingsChangesSubscription.unsubscribe();
      this.dataSettingsChangesSubscription = null;
    }
    if (this.targetDeviceSettingsSubscription) {
      this.targetDeviceSettingsSubscription.unsubscribe();
      this.targetDeviceSettingsSubscription = null;
    }
    if (this.alarmSourceSettingsSubscription) {
      this.alarmSourceSettingsSubscription.unsubscribe();
      this.alarmSourceSettingsSubscription = null;
    }
    if (this.widgetSettingsSubscription) {
      this.widgetSettingsSubscription.unsubscribe();
      this.widgetSettingsSubscription = null;
    }
    if (this.layoutSettingsSubscription) {
      this.layoutSettingsSubscription.unsubscribe();
      this.layoutSettingsSubscription = null;
    }
    if (this.advancedSettingsSubscription) {
      this.advancedSettingsSubscription.unsubscribe();
      this.advancedSettingsSubscription = null;
    }
    if (this.actionsSettingsSubscription) {
      this.actionsSettingsSubscription.unsubscribe();
      this.actionsSettingsSubscription = null;
    }
  }

  private createChangeSubscriptions() {
    this.dataSettingsChangesSubscription = this.dataSettings.valueChanges.subscribe(
      () => this.updateDataSettings()
    );
    this.targetDeviceSettingsSubscription = this.targetDeviceSettings.valueChanges.subscribe(
      () => this.updateTargetDeviceSettings()
    );
    this.alarmSourceSettingsSubscription = this.alarmSourceSettings.valueChanges.subscribe(
      () => this.updateAlarmSourceSettings()
    );
    this.widgetSettingsSubscription = this.widgetSettings.valueChanges.subscribe(
      () => this.updateWidgetSettings()
    );
    this.layoutSettingsSubscription = this.layoutSettings.valueChanges.subscribe(
      () => this.updateLayoutSettings()
    );
    this.advancedSettingsSubscription = this.advancedSettings.valueChanges.subscribe(
      () => this.updateAdvancedSettings()
    );
    this.actionsSettingsSubscription = this.actionsSettings.valueChanges.subscribe(
      () => this.updateActionSettings()
    );
  }

  private buildForms() {
    this.dataSettings = this.fb.group({});
    this.targetDeviceSettings = this.fb.group({});
    this.alarmSourceSettings = this.fb.group({});
    this.advancedSettings = this.fb.group({});
    if (this.widgetType === widgetType.timeseries || this.widgetType === widgetType.alarm) {
      this.dataSettings.addControl('useDashboardTimewindow', this.fb.control(null));
      this.dataSettings.addControl('displayTimewindow', this.fb.control(null));
      this.dataSettings.addControl('timewindow', this.fb.control(null));
      this.dataSettings.get('useDashboardTimewindow').valueChanges.subscribe((value: boolean) => {
        if (value) {
          this.dataSettings.get('displayTimewindow').disable({emitEvent: false});
          this.dataSettings.get('timewindow').disable({emitEvent: false});
        } else {
          this.dataSettings.get('displayTimewindow').enable({emitEvent: false});
          this.dataSettings.get('timewindow').enable({emitEvent: false});
        }
      });
      if (this.widgetType === widgetType.alarm) {
        this.dataSettings.addControl('alarmSearchStatus', this.fb.control(null));
        this.dataSettings.addControl('alarmsPollingInterval', this.fb.control(null,
          [Validators.required, Validators.min(1)]));
        this.dataSettings.addControl('alarmsMaxCountLoad', this.fb.control(null,
          [Validators.required, Validators.min(0)]));
        this.dataSettings.addControl('alarmsFetchSize', this.fb.control(null,
          [Validators.required, Validators.min(10)]));
      }
    }
    if (this.modelValue.isDataEnabled) {
      if (this.widgetType !== widgetType.rpc &&
        this.widgetType !== widgetType.alarm &&
        this.widgetType !== widgetType.static) {
        this.dataSettings.addControl('datasources',
          this.fb.array([]));
      } else if (this.widgetType === widgetType.rpc) {
        this.targetDeviceSettings.addControl('targetDeviceAliasId',
          this.fb.control(null,
            this.widgetEditMode ? [] : [Validators.required]));
      } else if (this.widgetType === widgetType.alarm) {
        this.alarmSourceSettings = this.buildDatasourceForm();
      }
    }
    this.advancedSettings.addControl('settings',
      this.fb.control(null, []));
  }

  datasourcesFormArray(): FormArray {
    return this.dataSettings.get('datasources') as FormArray;
  }

  registerOnChange(fn: any): void {
    this.propagateChange = fn;
  }

  registerOnTouched(fn: any): void {
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  writeValue(value: WidgetConfigComponentData): void {
    this.modelValue = value;
    this.removeChangeSubscriptions();
    if (this.modelValue) {
      if (this.widgetType !== this.modelValue.widgetType) {
        this.widgetType = this.modelValue.widgetType;
        this.buildForms();
      }
      const config = this.modelValue.config;
      const layout = this.modelValue.layout;
      if (config) {
        this.selectedTab = 0;
        this.widgetSettings.patchValue({
            title: config.title,
            showTitleIcon: isDefined(config.showTitleIcon) ? config.showTitleIcon : false,
            titleIcon: isDefined(config.titleIcon) ? config.titleIcon : '',
            iconColor: isDefined(config.iconColor) ? config.iconColor : 'rgba(0, 0, 0, 0.87)',
            iconSize: isDefined(config.iconSize) ? config.iconSize : '24px',
            titleTooltip: isDefined(config.titleTooltip) ? config.titleTooltip : '',
            showTitle: config.showTitle,
            dropShadow: isDefined(config.dropShadow) ? config.dropShadow : true,
            enableFullscreen: isDefined(config.enableFullscreen) ? config.enableFullscreen : true,
            backgroundColor: config.backgroundColor,
            color: config.color,
            padding: config.padding,
            margin: config.margin,
            widgetStyle: isDefined(config.widgetStyle) ? config.widgetStyle : {},
            titleStyle: isDefined(config.titleStyle) ? config.titleStyle : {
              fontSize: '16px',
              fontWeight: 400
            },
            units: config.units,
            decimals: config.decimals,
            showLegend: isDefined(config.showLegend) ? config.showLegend :
              this.widgetType === widgetType.timeseries,
            legendConfig: config.legendConfig || defaultLegendConfig(this.widgetType)
          },
          {emitEvent: false}
        );
        const showTitleIcon: boolean = this.widgetSettings.get('showTitleIcon').value;
        if (showTitleIcon) {
          this.widgetSettings.get('titleIcon').enable({emitEvent: false});
        } else {
          this.widgetSettings.get('titleIcon').disable({emitEvent: false});
        }
        const showLegend: boolean = this.widgetSettings.get('showLegend').value;
        if (showLegend) {
          this.widgetSettings.get('legendConfig').enable({emitEvent: false});
        } else {
          this.widgetSettings.get('legendConfig').disable({emitEvent: false});
        }
        const actionsData: WidgetActionsData = {
          actionsMap: config.actions || {},
          actionSources: this.modelValue.actionSources || {}
        };
        this.actionsSettings.patchValue(
          {
            actionsData
          },
          {emitEvent: false}
        );
        if (this.widgetType === widgetType.timeseries || this.widgetType === widgetType.alarm) {
          const useDashboardTimewindow = isDefined(config.useDashboardTimewindow) ?
            config.useDashboardTimewindow : true;
          this.dataSettings.patchValue(
            { useDashboardTimewindow }, {emitEvent: false}
          );
          if (useDashboardTimewindow) {
            this.dataSettings.get('displayTimewindow').disable({emitEvent: false});
            this.dataSettings.get('timewindow').disable({emitEvent: false});
          } else {
            this.dataSettings.get('displayTimewindow').enable({emitEvent: false});
            this.dataSettings.get('timewindow').enable({emitEvent: false});
          }
          this.dataSettings.patchValue(
            { displayTimewindow: isDefined(config.displayTimewindow) ?
                config.displayTimewindow : true }, {emitEvent: false}
          );
          this.dataSettings.patchValue(
            { timewindow: config.timewindow }, {emitEvent: false}
          );
        }
        if (this.modelValue.isDataEnabled) {
          if (this.widgetType !== widgetType.rpc &&
            this.widgetType !== widgetType.alarm &&
            this.widgetType !== widgetType.static) {
            const datasourcesFormArray = this.dataSettings.get('datasources') as FormArray;
            datasourcesFormArray.clear();
            if (config.datasources) {
              config.datasources.forEach((datasource) => {
                datasourcesFormArray.push(this.buildDatasourceForm(datasource));
              });
            }
          } else if (this.widgetType === widgetType.rpc) {
            let targetDeviceAliasId: string;
            if (config.targetDeviceAliasIds && config.targetDeviceAliasIds.length > 0) {
              const aliasId = config.targetDeviceAliasIds[0];
              const entityAliases = this.aliasController.getEntityAliases();
              if (entityAliases[aliasId]) {
                targetDeviceAliasId = entityAliases[aliasId].id;
              } else {
                targetDeviceAliasId = null;
              }
            } else {
              targetDeviceAliasId = null;
            }
            this.targetDeviceSettings.patchValue({
              targetDeviceAliasId
            }, {emitEvent: false});
          } else if (this.widgetType === widgetType.alarm) {
            this.dataSettings.patchValue(
              { alarmSearchStatus: isDefined(config.alarmSearchStatus) ?
                  config.alarmSearchStatus : AlarmSearchStatus.ANY }, {emitEvent: false}
            );
            this.dataSettings.patchValue(
              { alarmsPollingInterval: isDefined(config.alarmsPollingInterval) ?
                  config.alarmsPollingInterval : 5}, {emitEvent: false}
            );
            this.dataSettings.patchValue(
              { alarmsMaxCountLoad: isDefined(config.alarmsMaxCountLoad) ?
                  config.alarmsMaxCountLoad : 0}, {emitEvent: false}
            );
            this.dataSettings.patchValue(
              { alarmsFetchSize: isDefined(config.alarmsFetchSize) ?
                  config.alarmsFetchSize : 100}, {emitEvent: false}
            );
            this.alarmSourceSettings.patchValue(
              config.alarmSource, {emitEvent: false}
            );
            const alarmSourceType: DatasourceType = this.alarmSourceSettings.get('type').value;
            this.alarmSourceSettings.get('entityAliasId').setValidators(
              alarmSourceType === DatasourceType.entity ? [Validators.required] : []
            );
            this.alarmSourceSettings.get('entityAliasId').updateValueAndValidity({emitEvent: false});
          }
        }

        this.updateSchemaForm(config.settings);

        if (layout) {
          this.layoutSettings.patchValue(
            {
              mobileOrder: layout.mobileOrder,
              mobileHeight: layout.mobileHeight
            },
            {emitEvent: false}
          );
        } else {
          this.layoutSettings.patchValue(
            {
              mobileOrder: null,
              mobileHeight: null
            },
            {emitEvent: false}
          );
        }
      }
      this.createChangeSubscriptions();
    }
  }

  private buildDatasourceForm(datasource?: Datasource): FormGroup {
    const dataKeysRequired = !this.modelValue.typeParameters || !this.modelValue.typeParameters.dataKeysOptional;
    const datasourceFormGroup = this.fb.group(
      {
        type: [datasource ? datasource.type : null, [Validators.required]],
        name: [datasource ? datasource.name : null, []],
        entityAliasId: [datasource ? datasource.entityAliasId : null,
          datasource && datasource.type === DatasourceType.entity ? [Validators.required] : []],
        dataKeys: [datasource ? datasource.dataKeys : null, dataKeysRequired ? [Validators.required] : []]
      }
    );
    datasourceFormGroup.get('type').valueChanges.subscribe((type: DatasourceType) => {
      datasourceFormGroup.get('entityAliasId').setValidators(
        type === DatasourceType.entity ? [Validators.required] : []
      );
      datasourceFormGroup.get('entityAliasId').updateValueAndValidity();
    });
    return datasourceFormGroup;
  }

  private updateSchemaForm(settings?: any) {
    const widgetSettingsFormData: JsonFormComponentData = {};
    if (this.modelValue.settingsSchema && this.modelValue.settingsSchema.schema) {
      widgetSettingsFormData.schema = this.modelValue.settingsSchema.schema;
      widgetSettingsFormData.form = this.modelValue.settingsSchema.form || deepClone(defaultSettingsForm);
      widgetSettingsFormData.groupInfoes = this.modelValue.settingsSchema.groupInfoes;
      widgetSettingsFormData.model = settings;
    } else {
      widgetSettingsFormData.schema = deepClone(emptySettingsSchema);
      widgetSettingsFormData.form = deepClone(defaultSettingsForm);
      widgetSettingsFormData.groupInfoes = deepClone(emptySettingsGroupInfoes);
      widgetSettingsFormData.model = {};
    }
    this.advancedSettings.patchValue({ settings: widgetSettingsFormData }, {emitEvent: false});
  }

  private updateDataSettings() {
    if (this.modelValue) {
      if (this.modelValue.config) {
        Object.assign(this.modelValue.config, this.dataSettings.value);
      }
      this.propagateChange(this.modelValue);
    }
  }

  private updateTargetDeviceSettings() {
    if (this.modelValue) {
      if (this.modelValue.config) {
        const targetDeviceAliasId: string = this.targetDeviceSettings.get('targetDeviceAliasId').value;
        if (targetDeviceAliasId) {
          this.modelValue.config.targetDeviceAliasIds = [targetDeviceAliasId];
        } else {
          this.modelValue.config.targetDeviceAliasIds = [];
        }
      }
      this.propagateChange(this.modelValue);
    }
  }

  private updateAlarmSourceSettings() {
    if (this.modelValue) {
      if (this.modelValue.config) {
        const alarmSource: Datasource = this.alarmSourceSettings.value;
        this.modelValue.config.alarmSource = alarmSource;
      }
      this.propagateChange(this.modelValue);
    }
  }

  private updateWidgetSettings() {
    if (this.modelValue) {
      if (this.modelValue.config) {
        Object.assign(this.modelValue.config, this.widgetSettings.value);
      }
      this.propagateChange(this.modelValue);
    }
  }

  private updateLayoutSettings() {
    if (this.modelValue) {
      if (this.modelValue.layout) {
        Object.assign(this.modelValue.layout, this.layoutSettings.value);
      }
      this.propagateChange(this.modelValue);
    }
  }

  private updateAdvancedSettings() {
    if (this.modelValue) {
      if (this.modelValue.config) {
        const settings = this.advancedSettings.get('settings').value.model;
        this.modelValue.config.settings = settings;
      }
      this.propagateChange(this.modelValue);
    }
  }

  private updateActionSettings() {
    if (this.modelValue) {
      if (this.modelValue.config) {
        const actions = (this.actionsSettings.get('actionsData').value as WidgetActionsData).actionsMap;
        this.modelValue.config.actions = actions;
      }
      this.propagateChange(this.modelValue);
    }
  }

  public displayAdvanced(): boolean {
    return !!this.modelValue && !!this.modelValue.settingsSchema && !!this.modelValue.settingsSchema.schema;
  }

  public removeDatasource(index: number) {
    (this.dataSettings.get('datasources') as FormArray).removeAt(index);
  }

  public addDatasource() {
    let newDatasource: Datasource;
    if (this.functionsOnly) {
      newDatasource = deepClone(this.utils.getDefaultDatasource(this.modelValue.dataKeySettingsSchema.schema));
      newDatasource.dataKeys = [this.generateDataKey('Sin', DataKeyType.function)];
    } else {
      newDatasource = { type: DatasourceType.entity,
        dataKeys: []
      };
    }
    const datasourcesFormArray = this.dataSettings.get('datasources') as FormArray;
    datasourcesFormArray.push(this.buildDatasourceForm(newDatasource));
  }

  public generateDataKey(chip: any, type: DataKeyType): DataKey {
    if (isObject(chip)) {
      (chip as DataKey)._hash = Math.random();
      return chip;
    } else {
      let label: string = chip;
      if (type === DataKeyType.alarm || type === DataKeyType.entityField) {
        const keyField = type === DataKeyType.alarm ? alarmFields[label] : entityFields[chip];;
        if (keyField) {
          label = this.translate.instant(keyField.name);
        }
      }
      label = this.genNextLabel(label);
      const result: DataKey = {
        name: chip,
        type,
        label,
        color: this.genNextColor(),
        settings: {},
        _hash: Math.random()
      };
      if (type === DataKeyType.function) {
        result.name = 'f(x)';
        result.funcBody = this.utils.getPredefinedFunctionBody(chip);
        if (!result.funcBody) {
          result.funcBody = 'return prevValue + 1;';
        }
      }
      if (isDefined(this.modelValue.dataKeySettingsSchema.schema)) {
        result.settings = this.utils.generateObjectFromJsonSchema(this.modelValue.dataKeySettingsSchema.schema);
      }
      return result;
    }
  }

  private genNextLabel(name: string): string {
    let label = name;
    let i = 1;
    let matches = false;
    const datasources = this.widgetType === widgetType.alarm ? [this.modelValue.config.alarmSource] : this.modelValue.config.datasources;
    if (datasources) {
      do {
        matches = false;
        datasources.forEach((datasource) => {
          if (datasource && datasource.dataKeys) {
            datasource.dataKeys.forEach((dataKey) => {
              if (dataKey.label === label) {
                i++;
                label = name + ' ' + i;
                matches = true;
              }
            });
          }
        });
      } while (matches);
    }
    return label;
  }

  private genNextColor(): string {
    let i = 0;
    const datasources = this.widgetType === widgetType.alarm ? [this.modelValue.config.alarmSource] : this.modelValue.config.datasources;
    if (datasources) {
      datasources.forEach((datasource) => {
        if (datasource && datasource.dataKeys) {
          i += datasource.dataKeys.length;
        }
      });
    }
    return this.utils.getMaterialColor(i);
  }

  private createEntityAlias(alias: string, allowedEntityTypes: Array<EntityType>): Observable<EntityAlias> {
    const singleEntityAlias: EntityAlias = {id: null, alias, filter: {resolveMultiple: false}};
    return this.dialog.open<EntityAliasDialogComponent, EntityAliasDialogData,
      EntityAlias>(EntityAliasDialogComponent, {
      disableClose: true,
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
      data: {
        isAdd: true,
        allowedEntityTypes,
        entityAliases: this.entityAliases,
        alias: singleEntityAlias
      }
    }).afterClosed().pipe(
      tap((entityAlias) => {
        if (entityAlias) {
          this.entityAliases[entityAlias.id] = entityAlias;
          this.aliasController.updateEntityAliases(this.entityAliases);
        }
      })
    );
  }

  private fetchEntityKeys(entityAliasId: string, query: string, dataKeyTypes: Array<DataKeyType>): Observable<Array<DataKey>> {
    return this.aliasController.getAliasInfo(entityAliasId).pipe(
      mergeMap((aliasInfo) => {
        const entity = aliasInfo.currentEntity;
        if (entity) {
          const fetchEntityTasks: Array<Observable<Array<DataKey>>> = [];
          for (const dataKeyType of dataKeyTypes) {
            fetchEntityTasks.push(
              this.entityService.getEntityKeys(
                {entityType: entity.entityType, id: entity.id},
                query,
                dataKeyType,
                {ignoreLoading: true, ignoreErrors: true}
              ).pipe(
                map((keys) => {
                  const dataKeys: Array<DataKey> = [];
                  for (const key of keys) {
                    dataKeys.push({name: key, type: dataKeyType});
                  }
                  return dataKeys;
                }
                ),
                catchError(val => of([]))
            ));
          }
          return forkJoin(fetchEntityTasks).pipe(
            map(arrayOfDataKeys => {
              const result = new Array<DataKey>();
              arrayOfDataKeys.forEach((dataKeyArray) => {
                result.push(...dataKeyArray);
              });
              return result;
            }
          ));
        } else {
          return of([]);
        }
      }),
      catchError(val => of([] as Array<DataKey>))
    );
  }

  private fetchDashboardStates(query: string): Array<string> {
    const stateIds = Object.keys(this.dashboardStates);
    const result = query ? stateIds.filter(this.createFilterForDashboardState(query)) : stateIds;
    if (result && result.length) {
      return result;
    } else {
      return [query];
    }
  }

  private createFilterForDashboardState(query: string): (stateId: string) => boolean {
    const lowercaseQuery = query.toLowerCase();
    return stateId => stateId.toLowerCase().indexOf(lowercaseQuery) === 0;
  }

  public validate(c: FormControl) {
    if (!this.dataSettings.valid) {
      return {
        dataSettings: {
          valid: false
        }
      };
    } else if (!this.widgetSettings.valid) {
      return {
        widgetSettings: {
          valid: false
        }
      };
    } else if (!this.layoutSettings.valid) {
      return {
        widgetSettings: {
          valid: false
        }
      };
    } else if (!this.advancedSettings.valid) {
      return {
        advancedSettings: {
          valid: false
        }
      };
    } else if (this.modelValue) {
      const config = this.modelValue.config;
      if (this.widgetType === widgetType.rpc && this.modelValue.isDataEnabled) {
        if (!config.targetDeviceAliasIds || !config.targetDeviceAliasIds.length) {
          return {
            targetDeviceAliasIds: {
              valid: false
            }
          };
        }
      } else if (this.widgetType === widgetType.alarm && this.modelValue.isDataEnabled) {
        if (!config.alarmSource) {
          return {
            alarmSource: {
              valid: false
            }
          };
        }
      } else if (this.widgetType !== widgetType.static && this.modelValue.isDataEnabled) {
        if (!config.datasources || !config.datasources.length) {
          return {
            datasources: {
              valid: false
            }
          };
        }
      }
    }
    return null;
  }

}
