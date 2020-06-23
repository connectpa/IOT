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

import {
  IWidgetSubscription,
  SubscriptionEntityInfo,
  WidgetSubscriptionCallbacks,
  WidgetSubscriptionContext,
  WidgetSubscriptionOptions
} from '@core/api/widget-api.models';
import {
  DataKey,
  DataSet,
  DataSetHolder,
  Datasource,
  DatasourceData,
  DatasourceType,
  LegendConfig,
  LegendData,
  LegendKey,
  LegendKeyData,
  widgetType
} from '@app/shared/models/widget.models';
import { HttpErrorResponse } from '@angular/common/http';
import {
  createSubscriptionTimewindow,
  createTimewindowForComparison,
  SubscriptionTimewindow,
  Timewindow,
  toHistoryTimewindow,
  WidgetTimewindow
} from '@app/shared/models/time/time.models';
import { Observable, ReplaySubject, Subject, throwError } from 'rxjs';
import { CancelAnimationFrame } from '@core/services/raf.service';
import { EntityType } from '@shared/models/entity-type.models';
import { AlarmInfo, AlarmSearchStatus } from '@shared/models/alarm.models';
import { deepClone, isDefined, isEqual } from '@core/utils';
import { AlarmSourceListener } from '@core/http/alarm.service';
import { DatasourceListener } from '@core/api/datasource.service';
import { EntityId } from '@app/shared/models/id/entity-id';
import { DataKeyType } from '@shared/models/telemetry/telemetry.models';
import { entityFields } from '@shared/models/entity.models';
import * as moment_ from 'moment';

const moment = moment_;

export class WidgetSubscription implements IWidgetSubscription {

  id: string;
  ctx: WidgetSubscriptionContext;
  type: widgetType;
  callbacks: WidgetSubscriptionCallbacks;

  timeWindow: WidgetTimewindow;
  originalTimewindow: Timewindow;
  timeWindowConfig: Timewindow;
  subscriptionTimewindow: SubscriptionTimewindow;
  useDashboardTimewindow: boolean;

  data: Array<DatasourceData>;
  datasources: Array<Datasource>;
  datasourceListeners: Array<DatasourceListener>;
  hiddenData: Array<DataSetHolder>;
  legendData: LegendData;
  legendConfig: LegendConfig;
  caulculateLegendData: boolean;
  displayLegend: boolean;
  stateData: boolean;
  decimals: number;
  units: string;
  comparisonEnabled: boolean;
  timeForComparison: moment_.unitOfTime.DurationConstructor;
  comparisonTimeWindow: WidgetTimewindow;
  timewindowForComparison: SubscriptionTimewindow;

  alarms: Array<AlarmInfo>;
  alarmSource: Datasource;

  private alarmSearchStatusValue: AlarmSearchStatus;

  set alarmSearchStatus(value: AlarmSearchStatus) {
    if (this.alarmSearchStatusValue !== value) {
      this.alarmSearchStatusValue = value;
      this.onAlarmSearchStatusChanged();
    }
  }

  get alarmSearchStatus(): AlarmSearchStatus {
    return this.alarmSearchStatusValue;
  }

  alarmsPollingInterval: number;
  alarmsMaxCountLoad: number;
  alarmsFetchSize: number;
  alarmSourceListener: AlarmSourceListener;

  loadingData: boolean;

  targetDeviceAliasIds?: Array<string>;
  targetDeviceIds?: Array<string>;

  executingRpcRequest: boolean;
  rpcEnabled: boolean;
  rpcErrorText: string;
  rpcRejection: HttpErrorResponse;

  init$: Observable<IWidgetSubscription>;

  cafs: {[cafId: string]: CancelAnimationFrame} = {};
  hasResolvedData = false;

  targetDeviceAliasId: string;
  targetDeviceId: string;
  targetDeviceName: string;
  executingSubjects: Array<Subject<any>>;

  constructor(subscriptionContext: WidgetSubscriptionContext, public options: WidgetSubscriptionOptions) {
    const subscriptionSubject = new ReplaySubject<IWidgetSubscription>();
    this.init$ = subscriptionSubject.asObservable();
    this.ctx = subscriptionContext;
    this.type = options.type;
    this.id = this.ctx.utils.guid();
    this.callbacks = options.callbacks;

    if (this.type === widgetType.rpc) {
      this.callbacks.rpcStateChanged = this.callbacks.rpcStateChanged || (() => {});
      this.callbacks.onRpcSuccess = this.callbacks.onRpcSuccess || (() => {});
      this.callbacks.onRpcFailed = this.callbacks.onRpcFailed || (() => {});
      this.callbacks.onRpcErrorCleared = this.callbacks.onRpcErrorCleared || (() => {});

      this.targetDeviceAliasIds = options.targetDeviceAliasIds;
      this.targetDeviceIds = options.targetDeviceIds;

      this.targetDeviceAliasId = null;
      this.targetDeviceId = null;

      this.rpcRejection = null;
      this.rpcErrorText = null;
      this.rpcEnabled = false;
      this.executingRpcRequest = false;
      this.executingSubjects = [];
      this.initRpc().subscribe(() => {
        subscriptionSubject.next(this);
        subscriptionSubject.complete();
      });
    } else if (this.type === widgetType.alarm) {
      this.callbacks.onDataUpdated = this.callbacks.onDataUpdated || (() => {});
      this.callbacks.onDataUpdateError = this.callbacks.onDataUpdateError || (() => {});
      this.callbacks.dataLoading = this.callbacks.dataLoading || (() => {});
      this.callbacks.timeWindowUpdated = this.callbacks.timeWindowUpdated || (() => {});
      this.alarmSource = options.alarmSource;
      this.alarmSearchStatusValue = isDefined(options.alarmSearchStatus) ?
        options.alarmSearchStatus : AlarmSearchStatus.ANY;
      this.alarmsPollingInterval = isDefined(options.alarmsPollingInterval) ?
        options.alarmsPollingInterval : 5000;
      this.alarmsMaxCountLoad = isDefined(options.alarmsMaxCountLoad) ?
        options.alarmsMaxCountLoad : 0;
      this.alarmsFetchSize = isDefined(options.alarmsFetchSize) ?
        options.alarmsFetchSize : 100;
      this.alarmSourceListener = null;
      this.alarms = [];
      this.originalTimewindow = null;
      this.timeWindow = {};
      this.useDashboardTimewindow = options.useDashboardTimewindow;
      if (this.useDashboardTimewindow) {
        this.timeWindowConfig = deepClone(options.dashboardTimewindow);
      } else {
        this.timeWindowConfig = deepClone(options.timeWindowConfig);
      }
      this.subscriptionTimewindow = null;
      this.loadingData = false;
      this.displayLegend = false;
      this.initAlarmSubscription().subscribe(() => {
        subscriptionSubject.next(this);
        subscriptionSubject.complete();
      },
      () => {
        subscriptionSubject.error(null);
      });
    } else {
      this.callbacks.onDataUpdated = this.callbacks.onDataUpdated || (() => {});
      this.callbacks.onDataUpdateError = this.callbacks.onDataUpdateError || (() => {});
      this.callbacks.dataLoading = this.callbacks.dataLoading || (() => {});
      this.callbacks.legendDataUpdated = this.callbacks.legendDataUpdated || (() => {});
      this.callbacks.timeWindowUpdated = this.callbacks.timeWindowUpdated || (() => {});

      this.datasources = this.ctx.utils.validateDatasources(options.datasources);
      this.datasourceListeners = [];
      this.data = [];
      this.hiddenData = [];
      this.originalTimewindow = null;
      this.timeWindow = {};
      this.useDashboardTimewindow = options.useDashboardTimewindow;
      this.stateData = options.stateData;
      if (this.useDashboardTimewindow) {
        this.timeWindowConfig = deepClone(options.dashboardTimewindow);
      } else {
        this.timeWindowConfig = deepClone(options.timeWindowConfig);
      }

      this.subscriptionTimewindow = null;
      this.comparisonEnabled = options.comparisonEnabled;
      if (this.comparisonEnabled) {
        this.timeForComparison = options.timeForComparison;

        this.comparisonTimeWindow = {};
        this.timewindowForComparison = null;
      }

      this.units = options.units || '';
      this.decimals = isDefined(options.decimals) ? options.decimals : 2;

      this.loadingData = false;

      if (options.legendConfig) {
        this.legendConfig = options.legendConfig;
        this.legendData = {
          keys: [],
          data: []
        };
        this.displayLegend = true;
      } else {
        this.displayLegend = false;
      }
      this.caulculateLegendData = this.displayLegend &&
        this.type === widgetType.timeseries &&
        (this.legendConfig.showMin === true ||
          this.legendConfig.showMax === true ||
          this.legendConfig.showAvg === true ||
          this.legendConfig.showTotal === true);
      this.initDataSubscription().subscribe(() => {
          subscriptionSubject.next(this);
          subscriptionSubject.complete();
        },
        (err) => {
          subscriptionSubject.error(err);
        });
    }
 }

  private initRpc(): Observable<any> {
    const initRpcSubject = new ReplaySubject();
    if (this.targetDeviceAliasIds && this.targetDeviceAliasIds.length > 0) {
      this.targetDeviceAliasId = this.targetDeviceAliasIds[0];
      this.ctx.aliasController.getAliasInfo(this.targetDeviceAliasId).subscribe(
        (aliasInfo) => {
          if (aliasInfo.currentEntity && aliasInfo.currentEntity.entityType === EntityType.DEVICE) {
            this.targetDeviceId = aliasInfo.currentEntity.id;
            this.targetDeviceName = aliasInfo.currentEntity.name;
            if (this.targetDeviceId) {
              this.rpcEnabled = true;
            } else {
              this.rpcEnabled = this.ctx.utils.widgetEditMode ? true : false;
            }
            this.hasResolvedData = this.rpcEnabled;
            this.callbacks.rpcStateChanged(this);
            initRpcSubject.next();
            initRpcSubject.complete();
          } else {
            this.rpcEnabled = false;
            this.callbacks.rpcStateChanged(this);
            initRpcSubject.next();
            initRpcSubject.complete();
          }
        },
        () => {
          this.rpcEnabled = false;
          this.callbacks.rpcStateChanged(this);
          initRpcSubject.next();
          initRpcSubject.complete();
        }
      );
    } else {
      if (this.targetDeviceIds && this.targetDeviceIds.length > 0) {
        this.targetDeviceId = this.targetDeviceIds[0];
      }
      if (this.targetDeviceId) {
        this.rpcEnabled = true;
      } else {
        this.rpcEnabled = this.ctx.utils.widgetEditMode ? true : false;
      }
      this.hasResolvedData = true;
      this.callbacks.rpcStateChanged(this);
      initRpcSubject.next();
      initRpcSubject.complete();
    }
    return initRpcSubject.asObservable();
  }

  private initAlarmSubscription(): Observable<any> {
    const initAlarmSubscriptionSubject = new ReplaySubject(1);
    this.loadStDiff().subscribe(() => {
      if (!this.ctx.aliasController) {
        this.hasResolvedData = true;
        this.configureAlarmsData();
        initAlarmSubscriptionSubject.next();
        initAlarmSubscriptionSubject.complete();
      } else {
        this.ctx.aliasController.resolveAlarmSource(this.alarmSource).subscribe(
          (alarmSource) => {
            this.alarmSource = alarmSource;
            if (alarmSource) {
              this.hasResolvedData = true;
            }
            this.configureAlarmsData();
            initAlarmSubscriptionSubject.next();
            initAlarmSubscriptionSubject.complete();
          },
          (err) => {
            initAlarmSubscriptionSubject.error(err);
          }
        );
      }
    });
    return initAlarmSubscriptionSubject.asObservable();
  }

  private configureAlarmsData() {
  }

  private initDataSubscription(): Observable<any> {
    const initDataSubscriptionSubject = new ReplaySubject(1);
    this.loadStDiff().subscribe(() => {
      if (!this.ctx.aliasController) {
        this.hasResolvedData = true;
        this.configureData();
        initDataSubscriptionSubject.next();
        initDataSubscriptionSubject.complete();
      } else {
        this.ctx.aliasController.resolveDatasources(this.datasources).subscribe(
          (datasources) => {
            this.datasources = datasources;
            if (datasources && datasources.length) {
              this.hasResolvedData = true;
            }
            this.configureData();
            initDataSubscriptionSubject.next();
            initDataSubscriptionSubject.complete();
          },
          (err) => {
            this.notifyDataLoaded();
            initDataSubscriptionSubject.error(err);
          }
        );
      }
    });
    return initDataSubscriptionSubject.asObservable();
  }

  private configureData() {
    const additionalDatasources: Datasource[] = [];
    let dataIndex = 0;
    let additionalKeysNumber = 0;
    this.datasources.forEach((datasource) => {
      const additionalDataKeys: DataKey[] = [];
      let datasourceAdditionalKeysNumber = 0;
      datasource.dataKeys.forEach((dataKey) => {
        dataKey.hidden = dataKey.settings.hideDataByDefault ? true : false;
        dataKey.inLegend = dataKey.settings.removeFromLegend ? false : true;
        dataKey.pattern = dataKey.label;
        if (this.comparisonEnabled && dataKey.settings.comparisonSettings && dataKey.settings.comparisonSettings.showValuesForComparison) {
          datasourceAdditionalKeysNumber++;
          additionalKeysNumber++;
          const additionalDataKey = this.ctx.utils.createAdditionalDataKey(dataKey, datasource,
            this.timeForComparison, this.datasources, additionalKeysNumber);
          dataKey.settings.comparisonSettings.color = additionalDataKey.color;
          additionalDataKeys.push(additionalDataKey);
        }
        const datasourceData: DatasourceData = {
          datasource,
          dataKey,
          data: []
        };
        if (dataKey.type === DataKeyType.entityField && datasource.entity) {
          const propName = entityFields[dataKey.name] ? entityFields[dataKey.name].value : dataKey.name;
          if (datasource.entity[propName]) {
            datasourceData.data.push([Date.now(), datasource.entity[propName]]);
          }
        }
        this.data.push(datasourceData);
        this.hiddenData.push({data: []});
        if (this.displayLegend) {
          const legendKey: LegendKey = {
            dataKey,
            dataIndex: dataIndex++
          };
          this.legendData.keys.push(legendKey);
          const legendKeyData: LegendKeyData = {
            min: null,
            max: null,
            avg: null,
            total: null,
            hidden: false
          };
          this.legendData.data.push(legendKeyData);
        }
      });
      if (datasourceAdditionalKeysNumber > 0) {
        const additionalDatasource: Datasource = deepClone(datasource);
        additionalDatasource.dataKeys = additionalDataKeys;
        additionalDatasource.isAdditional = true;
        additionalDatasources.push(additionalDatasource);
      }
    });

    additionalDatasources.forEach((additionalDatasource) => {
      additionalDatasource.dataKeys.forEach((additionalDataKey) => {
        const additionalDatasourceData: DatasourceData = {
          datasource: additionalDatasource,
          dataKey: additionalDataKey,
          data: []
        };
        this.data.push(additionalDatasourceData);
        this.hiddenData.push({data: []});
        if (this.displayLegend) {
          const additionalLegendKey: LegendKey = {
            dataKey: additionalDataKey,
            dataIndex: dataIndex++
          };
          this.legendData.keys.push(additionalLegendKey);
          const additionalLegendKeyData: LegendKeyData = {
            min: null,
            max: null,
            avg: null,
            total: null,
            hidden: false
          };
          this.legendData.data.push(additionalLegendKeyData);
        }
      });
    });

    this.datasources = this.datasources.concat(additionalDatasources);

    if (this.displayLegend) {
      this.legendData.keys = this.legendData.keys.sort((key1, key2) => key1.dataKey.label.localeCompare(key2.dataKey.label));
    }
  }

  private resetData() {
    for (let i = 0; i < this.data.length; i++) {
      this.data[i].data = [];
      this.hiddenData[i].data = [];
      if (this.displayLegend) {
        this.legendData.data[i].min = null;
        this.legendData.data[i].max = null;
        this.legendData.data[i].avg = null;
        this.legendData.data[i].total = null;
        this.legendData.data[i].hidden = false;
      }
    }
    this.onDataUpdated();
  }

  getFirstEntityInfo(): SubscriptionEntityInfo {
    let entityId: EntityId;
    let entityName: string;
    let entityLabel: string;
    if (this.type === widgetType.rpc) {
      if (this.targetDeviceId) {
        entityId = {
          entityType: EntityType.DEVICE,
          id: this.targetDeviceId
        };
        entityName = this.targetDeviceName;
      }
    } else if (this.type === widgetType.alarm) {
      if (this.alarmSource && this.alarmSource.entityType && this.alarmSource.entityId) {
        entityId = {
          entityType: this.alarmSource.entityType,
          id: this.alarmSource.entityId
        };
        entityName = this.alarmSource.entityName;
        entityLabel = this.alarmSource.entityLabel;
      }
    } else {
      for (const datasource of this.datasources) {
        if (datasource && datasource.entityType && datasource.entityId) {
          entityId = {
            entityType: datasource.entityType,
            id: datasource.entityId
          };
          entityName = datasource.entityName;
          entityLabel = datasource.entityLabel;
          break;
        }
      }
    }
    if (entityId) {
      return {
        entityId,
        entityName,
        entityLabel
      };
    } else {
      return null;
    }
  }

  onAliasesChanged(aliasIds: Array<string>): boolean {
    if (this.type === widgetType.rpc) {
      return this.checkRpcTarget(aliasIds);
    } else if (this.type === widgetType.alarm) {
      return this.checkAlarmSource(aliasIds);
    } else {
      return this.checkSubscriptions(aliasIds);
    }
    return false;
  }

  private onDataUpdated(detectChanges?: boolean) {
    if (this.cafs.dataUpdated) {
      this.cafs.dataUpdated();
      this.cafs.dataUpdated = null;
    }
    this.cafs.dataUpdated = this.ctx.raf.raf(() => {
      try {
        this.callbacks.onDataUpdated(this, detectChanges);
      } catch (e) {
        this.callbacks.onDataUpdateError(this, e);
      }
    });
  }

  onDashboardTimewindowChanged(newDashboardTimewindow: Timewindow): void {
    if (this.type === widgetType.timeseries || this.type === widgetType.alarm) {
      if (this.useDashboardTimewindow) {
        if (!isEqual(this.timeWindowConfig, newDashboardTimewindow) && newDashboardTimewindow) {
          this.timeWindowConfig = deepClone(newDashboardTimewindow);
          this.update();
        }
      }
    }
  }

  private onAlarmSearchStatusChanged() {
    if (this.type === widgetType.alarm) {
      this.update();
    }
  }

  updateDataVisibility(index: number): void {
    if (this.displayLegend) {
      const hidden = this.legendData.keys[index].dataKey.hidden;
      if (hidden) {
        this.hiddenData[index].data = this.data[index].data;
        this.data[index].data = [];
      } else {
        this.data[index].data = this.hiddenData[index].data;
        this.hiddenData[index].data = [];
      }
      this.onDataUpdated();
    }
  }

  updateTimewindowConfig(newTimewindow: Timewindow): void {
    if (!this.useDashboardTimewindow) {
      this.timeWindowConfig = newTimewindow;
      this.update();
    }
  }

  onResetTimewindow(): void {
    if (this.useDashboardTimewindow) {
      this.ctx.dashboardTimewindowApi.onResetTimewindow();
    } else {
      if (this.originalTimewindow) {
        this.timeWindowConfig = deepClone(this.originalTimewindow);
        this.originalTimewindow = null;
        this.callbacks.timeWindowUpdated(this, this.timeWindowConfig);
        this.update();
      }
    }
  }

  onUpdateTimewindow(startTimeMs: number, endTimeMs: number, interval?: number): void {
    if (this.useDashboardTimewindow) {
      this.ctx.dashboardTimewindowApi.onUpdateTimewindow(startTimeMs, endTimeMs);
    } else {
      if (!this.originalTimewindow) {
        this.originalTimewindow = deepClone(this.timeWindowConfig);
      }
      this.timeWindowConfig = toHistoryTimewindow(this.timeWindowConfig, startTimeMs, endTimeMs, interval, this.ctx.timeService);
      this.callbacks.timeWindowUpdated(this, this.timeWindowConfig);
      this.update();
    }
  }

  sendOneWayCommand(method: string, params?: any, timeout?: number): Observable<any> {
    return this.sendCommand(true, method, params, timeout);
  }

  sendTwoWayCommand(method: string, params?: any, timeout?: number): Observable<any> {
    return this.sendCommand(false, method, params, timeout);
  }

  clearRpcError(): void {
    this.rpcRejection = null;
    this.rpcErrorText = null;
    this.callbacks.onRpcErrorCleared(this);
  }

  sendCommand(oneWayElseTwoWay: boolean, method: string, params?: any, timeout?: number): Observable<any> {
    if (!this.rpcEnabled) {
      return throwError(new Error('Rpc disabled!'));
    } else {
      if (this.rpcRejection && this.rpcRejection.status !== 408) {
        this.rpcRejection = null;
        this.rpcErrorText = null;
        this.callbacks.onRpcErrorCleared(this);
      }
      const requestBody: any = {
        method,
        params
      };
      if (timeout && timeout > 0) {
        requestBody.timeout = timeout;
      }
      const rpcSubject: Subject<any> = new ReplaySubject<any>();
      this.executingRpcRequest = true;
      this.callbacks.rpcStateChanged(this);
      if (this.ctx.utils.widgetEditMode) {
        setTimeout(() => {
          this.executingRpcRequest = false;
          this.callbacks.rpcStateChanged(this);
          if (oneWayElseTwoWay) {
            rpcSubject.next();
            rpcSubject.complete();
          } else {
            rpcSubject.next(requestBody);
            rpcSubject.complete();
          }
        }, 500);
      } else {
        this.executingSubjects.push(rpcSubject);
        (oneWayElseTwoWay ? this.ctx.deviceService.sendOneWayRpcCommand(this.targetDeviceId, requestBody) :
          this.ctx.deviceService.sendTwoWayRpcCommand(this.targetDeviceId, requestBody))
        .subscribe((responseBody) => {
          this.rpcRejection = null;
          this.rpcErrorText = null;
          const index = this.executingSubjects.indexOf(rpcSubject);
          if (index >= 0) {
            this.executingSubjects.splice( index, 1 );
          }
          this.executingRpcRequest = this.executingSubjects.length > 0;
          this.callbacks.onRpcSuccess(this);
          rpcSubject.next(responseBody);
          rpcSubject.complete();
        },
        (rejection: HttpErrorResponse) => {
          const index = this.executingSubjects.indexOf(rpcSubject);
          if (index >= 0) {
            this.executingSubjects.splice( index, 1 );
          }
          this.executingRpcRequest = this.executingSubjects.length > 0;
          this.callbacks.rpcStateChanged(this);
          if (!this.executingRpcRequest || rejection.status === 408) {
            this.rpcRejection = rejection;
            if (rejection.status === 408) {
              this.rpcErrorText = 'Request Timeout.';
            } else if (rejection.status === 409) {
              this.rpcErrorText = 'Device is offline.';
            } else {
              this.rpcErrorText =  'Error : ' + rejection.status + ' - ' + rejection.statusText;
              const error = this.extractRejectionErrorText(rejection);
              if (error) {
                this.rpcErrorText += '</br>';
                this.rpcErrorText += error;
              }
            }
            this.callbacks.onRpcFailed(this);
          }
          rpcSubject.error(rejection);
        });
      }
      return rpcSubject.asObservable();
    }
  }

  private extractRejectionErrorText(rejection: HttpErrorResponse) {
    let error = null;
    if (rejection.error) {
      error = rejection.error;
      try {
        error = rejection.error ? JSON.parse(rejection.error) : null;
      } catch (e) {}
    }
    if (error && !error.message) {
      error = this.prepareMessageFromData(error);
    } else if (error && error.message) {
      error = error.message;
    }
    return error;
  }

  private prepareMessageFromData(data) {
    if (typeof data === 'object' && data.constructor === ArrayBuffer) {
      const msg = String.fromCharCode.apply(null, new Uint8Array(data));
      try {
        const msgObj = JSON.parse(msg);
        if (msgObj.message) {
          return msgObj.message;
        } else {
          return msg;
        }
      } catch (e) {
        return msg;
      }
    } else {
      return data;
    }
  }

  update() {
    this.unsubscribe();
    this.subscribe();
  }

  subscribe(): void {
    if (this.cafs.subscribe) {
      this.cafs.subscribe();
      this.cafs.subscribe = null;
    }
    this.cafs.subscribe = this.ctx.raf.raf(() => {
      this.doSubscribe();
    });
  }

  private doSubscribe() {
    if (this.type === widgetType.rpc) {
      return;
    }
    if (this.type === widgetType.alarm) {
      this.alarmsSubscribe();
    } else {
      this.notifyDataLoading();
      if (this.type === widgetType.timeseries && this.timeWindowConfig) {
        this.updateRealtimeSubscription();
        if (this.comparisonEnabled) {
          this.updateSubscriptionForComparison();
        }
        if (this.subscriptionTimewindow.fixedWindow) {
          this.onDataUpdated();
        }
      }
      let index = 0;
      let forceUpdate = !this.datasources.length;
      this.datasources.forEach((datasource) => {
        const listener: DatasourceListener = {
          subscriptionType: this.type,
          subscriptionTimewindow: this.subscriptionTimewindow,
          datasource,
          entityType: datasource.entityType,
          entityId: datasource.entityId,
          dataUpdated: this.dataUpdated.bind(this),
          updateRealtimeSubscription: () => {
            this.subscriptionTimewindow = this.updateRealtimeSubscription();
            return this.subscriptionTimewindow;
          },
          setRealtimeSubscription: (subscriptionTimewindow) => {
            this.updateRealtimeSubscription(deepClone(subscriptionTimewindow));
          },
          datasourceIndex: index
        };

        if (this.comparisonEnabled && datasource.isAdditional) {
          listener.subscriptionTimewindow = this.timewindowForComparison;
          listener.updateRealtimeSubscription = () => {
            this.subscriptionTimewindow = this.updateSubscriptionForComparison();
            return this.subscriptionTimewindow;
          };
          listener.setRealtimeSubscription = () => {
            this.updateSubscriptionForComparison();
          };
        }

        let entityFieldKey = false;

        for (let a = 0; a < datasource.dataKeys.length; a++) {
          if (datasource.dataKeys[a].type !== DataKeyType.entityField) {
            this.data[index + a].data = [];
          } else {
            entityFieldKey = true;
          }
        }
        index += datasource.dataKeys.length;
        this.datasourceListeners.push(listener);

        if (datasource.dataKeys.length) {
          this.ctx.datasourceService.subscribeToDatasource(listener);
        }
        if (datasource.unresolvedStateEntity || entityFieldKey ||
          !datasource.dataKeys.length ||
          (datasource.type === DatasourceType.entity && !datasource.entityId)
        ) {
          forceUpdate = true;
        }
      });
      if (forceUpdate) {
        this.notifyDataLoaded();
        this.onDataUpdated();
      }
    }
  }

  private alarmsSubscribe() {
    this.notifyDataLoading();
    if (this.timeWindowConfig) {
      this.updateRealtimeSubscription();
      if (this.subscriptionTimewindow.fixedWindow) {
        this.onDataUpdated();
      }
    }
    this.alarmSourceListener = {
      subscriptionTimewindow: this.subscriptionTimewindow,
      alarmSource: this.alarmSource,
      alarmSearchStatus: this.alarmSearchStatus,
      alarmsPollingInterval: this.alarmsPollingInterval,
      alarmsMaxCountLoad: this.alarmsMaxCountLoad,
      alarmsFetchSize: this.alarmsFetchSize,
      alarmsUpdated: alarms => this.alarmsUpdated(alarms)
    };
    this.alarms = null;

    this.ctx.alarmService.subscribeForAlarms(this.alarmSourceListener);

    let forceUpdate = false;
    if (this.alarmSource.unresolvedStateEntity ||
      (this.alarmSource.type === DatasourceType.entity && !this.alarmSource.entityId)
    ) {
      forceUpdate = true;
    }
    if (forceUpdate) {
      this.notifyDataLoaded();
      this.onDataUpdated();
    }
  }


  unsubscribe() {
    if (this.type !== widgetType.rpc) {
      if (this.type === widgetType.alarm) {
        this.alarmsUnsubscribe();
      } else {
        this.datasourceListeners.forEach((listener) => {
          this.ctx.datasourceService.unsubscribeFromDatasource(listener);
        });
        this.datasourceListeners.length = 0;
        this.resetData();
      }
    }
  }

  private alarmsUnsubscribe() {
    if (this.alarmSourceListener) {
      this.ctx.alarmService.unsubscribeFromAlarms(this.alarmSourceListener);
      this.alarmSourceListener = null;
    }
  }

  private checkRpcTarget(aliasIds: Array<string>): boolean {
    if (aliasIds.indexOf(this.targetDeviceAliasId) > -1) {
      return true;
    } else {
      return false;
    }
  }

  private checkAlarmSource(aliasIds: Array<string>): boolean {
    if (this.options.alarmSource && this.options.alarmSource.entityAliasId) {
      return aliasIds.indexOf(this.options.alarmSource.entityAliasId) > -1;
    } else {
      return false;
    }
  }

  private checkSubscriptions(aliasIds: Array<string>): boolean {
    let subscriptionsChanged = false;
    const datasources = this.options.datasources;
    if (datasources) {
      for (const datasource of datasources) {
        if (datasource.entityAliasId) {
          if (aliasIds.indexOf(datasource.entityAliasId) > -1) {
            subscriptionsChanged = true;
            break;
          }
        }
      }
    }
    return subscriptionsChanged;
  }

  isDataResolved(): boolean {
    return this.hasResolvedData;
  }

  destroy(): void {
    this.unsubscribe();
    for (const cafId of Object.keys(this.cafs)) {
      if (this.cafs[cafId]) {
        this.cafs[cafId]();
        this.cafs[cafId] = null;
      }
    }
  }

  private notifyDataLoading() {
    this.loadingData = true;
    this.callbacks.dataLoading(this);
  }

  private notifyDataLoaded() {
    this.loadingData = false;
    this.callbacks.dataLoading(this);
  }

  private updateTimewindow() {
    this.timeWindow.interval = this.subscriptionTimewindow.aggregation.interval || 1000;
    if (this.subscriptionTimewindow.realtimeWindowMs) {
      this.timeWindow.maxTime = moment().valueOf() + this.timeWindow.stDiff;
      this.timeWindow.minTime = this.timeWindow.maxTime - this.subscriptionTimewindow.realtimeWindowMs;
    } else if (this.subscriptionTimewindow.fixedWindow) {
      this.timeWindow.maxTime = this.subscriptionTimewindow.fixedWindow.endTimeMs;
      this.timeWindow.minTime = this.subscriptionTimewindow.fixedWindow.startTimeMs;
    }
  }

  private updateRealtimeSubscription(subscriptionTimewindow?: SubscriptionTimewindow) {
    if (subscriptionTimewindow) {
      this.subscriptionTimewindow = subscriptionTimewindow;
    } else {
      this.subscriptionTimewindow =
        createSubscriptionTimewindow(this.timeWindowConfig, this.timeWindow.stDiff,
          this.stateData, this.ctx.timeService);
    }
    this.updateTimewindow();
    return this.subscriptionTimewindow;
  }

  private updateComparisonTimewindow() {
    this.comparisonTimeWindow.interval = this.timewindowForComparison.aggregation.interval || 1000;
    if (this.timewindowForComparison.realtimeWindowMs) {
      this.comparisonTimeWindow.maxTime = moment(this.timeWindow.maxTime).subtract(1, this.timeForComparison).valueOf();
      this.comparisonTimeWindow.minTime = this.comparisonTimeWindow.maxTime - this.timewindowForComparison.realtimeWindowMs;
    } else if (this.timewindowForComparison.fixedWindow) {
      this.comparisonTimeWindow.maxTime = this.timewindowForComparison.fixedWindow.endTimeMs;
      this.comparisonTimeWindow.minTime = this.timewindowForComparison.fixedWindow.startTimeMs;
    }
  }

  private updateSubscriptionForComparison() {
    if (!this.subscriptionTimewindow) {
      this.subscriptionTimewindow = this.updateRealtimeSubscription();
    }
    this.timewindowForComparison = createTimewindowForComparison(this.subscriptionTimewindow, this.timeForComparison);
    this.updateComparisonTimewindow();
    return this.timewindowForComparison;
  }

  private dataUpdated(sourceData: DataSetHolder, datasourceIndex: number, dataKeyIndex: number, detectChanges: boolean) {
    for (let x = 0; x < this.datasourceListeners.length; x++) {
      this.datasources[x].dataReceived = this.datasources[x].dataReceived === true;
      if (this.datasourceListeners[x].datasourceIndex === datasourceIndex && sourceData.data.length > 0) {
        this.datasources[x].dataReceived = true;
      }
    }
    this.notifyDataLoaded();
    let update = true;
    let currentData: DataSetHolder;
    if (this.displayLegend && this.legendData.keys[datasourceIndex + dataKeyIndex].dataKey.hidden) {
      currentData = this.hiddenData[datasourceIndex + dataKeyIndex];
    } else {
      currentData = this.data[datasourceIndex + dataKeyIndex];
    }
    if (this.type === widgetType.latest) {
      const prevData = currentData.data;
      if (!sourceData.data.length) {
        update = false;
      } else if (prevData && prevData[0] && prevData[0].length > 1 && sourceData.data.length > 0) {
        const prevTs = prevData[0][0];
        const prevValue = prevData[0][1];
        if (prevTs === sourceData.data[0][0] && prevValue === sourceData.data[0][1]) {
          update = false;
        }
      }
    }
    if (update) {
      if (this.subscriptionTimewindow && this.subscriptionTimewindow.realtimeWindowMs) {
        this.updateTimewindow();
        if (this.timewindowForComparison && this.timewindowForComparison.realtimeWindowMs) {
          this.updateComparisonTimewindow();
        }
      }
      currentData.data = sourceData.data;
      if (this.caulculateLegendData) {
        this.updateLegend(datasourceIndex + dataKeyIndex, sourceData.data, detectChanges);
      }
      this.onDataUpdated(detectChanges);
    }
  }

  private alarmsUpdated(alarms: Array<AlarmInfo>) {
    this.notifyDataLoaded();
    const updated = !this.alarms || !isEqual(this.alarms, alarms);
    this.alarms = alarms;
    if (this.subscriptionTimewindow && this.subscriptionTimewindow.realtimeWindowMs) {
      this.updateTimewindow();
    }
    if (updated) {
      this.onDataUpdated();
    }
  }

  private updateLegend(dataIndex: number, data: DataSet, detectChanges: boolean) {
    const dataKey = this.legendData.keys[dataIndex].dataKey;
    const decimals = isDefined(dataKey.decimals) ? dataKey.decimals : this.decimals;
    const units = dataKey.units && dataKey.units.length ? dataKey.units : this.units;
    const legendKeyData = this.legendData.data[dataIndex];
    if (this.legendConfig.showMin) {
      legendKeyData.min = this.ctx.widgetUtils.formatValue(calculateMin(data), decimals, units);
    }
    if (this.legendConfig.showMax) {
      legendKeyData.max = this.ctx.widgetUtils.formatValue(calculateMax(data), decimals, units);
    }
    if (this.legendConfig.showAvg) {
      legendKeyData.avg = this.ctx.widgetUtils.formatValue(calculateAvg(data), decimals, units);
    }
    if (this.legendConfig.showTotal) {
      legendKeyData.total = this.ctx.widgetUtils.formatValue(calculateTotal(data), decimals, units);
    }
    this.callbacks.legendDataUpdated(this, detectChanges !== false);
  }


  private loadStDiff(): Observable<any> {
    const loadSubject = new ReplaySubject(1);
    if (this.ctx.getServerTimeDiff && this.timeWindow) {
      this.ctx.getServerTimeDiff().subscribe(
        (stDiff) => {
          this.timeWindow.stDiff = stDiff;
          loadSubject.next();
          loadSubject.complete();
        },
        () => {
          this.timeWindow.stDiff = 0;
          loadSubject.next();
          loadSubject.complete();
        }
      );
    } else {
      if (this.timeWindow) {
        this.timeWindow.stDiff = 0;
      }
      loadSubject.next();
      loadSubject.complete();
    }
    return loadSubject.asObservable();
  }
}

function calculateMin(data: DataSet): number {
  if (data.length > 0) {
    let result = Number(data[0][1]);
    for (let i = 1; i < data.length; i++) {
      result = Math.min(result, Number(data[i][1]));
    }
    return result;
  } else {
    return null;
  }
}

function calculateMax(data: DataSet): number {
  if (data.length > 0) {
    let result = Number(data[0][1]);
    for (let i = 1; i < data.length; i++) {
      result = Math.max(result, Number(data[i][1]));
    }
    return result;
  } else {
    return null;
  }
}

function calculateAvg(data: DataSet): number {
  if (data.length > 0) {
    return calculateTotal(data) / data.length;
  } else {
    return null;
  }
}

function calculateTotal(data: DataSet): number {
  if (data.length > 0) {
    let result = 0;
    data.forEach((dataRow) => {
      result += Number(dataRow[1]);
    });
    return result;
  } else {
    return null;
  }
}
