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

import { Component, ElementRef, forwardRef, Input, OnInit, ViewChild } from '@angular/core';
import { PageComponent } from '@shared/components/page.component';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import { DataKey } from '@shared/models/widget.models';
import {
  ControlValueAccessor,
  FormBuilder,
  FormControl,
  FormGroup,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  Validator,
  Validators
} from '@angular/forms';
import { UtilsService } from '@core/services/utils.service';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { EntityService } from '@core/http/entity.service';
import { DataKeysCallbacks } from '@home/components/widget/data-keys.component.models';
import { DataKeyType } from '@shared/models/telemetry/telemetry.models';
import { Observable, of } from 'rxjs';
import { map, mergeMap, tap } from 'rxjs/operators';
import { alarmFields } from '@shared/models/alarm.models';
import { JsFuncComponent } from '@shared/components/js-func.component';
import { JsonFormComponentData } from '@shared/components/json-form/json-form-component.models';

@Component({
  selector: 'tb-data-key-config',
  templateUrl: './data-key-config.component.html',
  styleUrls: ['./data-key-config.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DataKeyConfigComponent),
      multi: true
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => DataKeyConfigComponent),
      multi: true,
    }
  ]
})
export class DataKeyConfigComponent extends PageComponent implements OnInit, ControlValueAccessor, Validator {

  dataKeyTypes = DataKeyType;

  @Input()
  entityAliasId: string;

  @Input()
  callbacks: DataKeysCallbacks;

  @Input()
  dataKeySettingsSchema: any;

  @ViewChild('keyInput') keyInput: ElementRef;

  @ViewChild('funcBodyEdit') funcBodyEdit: JsFuncComponent;
  @ViewChild('postFuncBodyEdit') postFuncBodyEdit: JsFuncComponent;

  displayAdvanced = false;

  modelValue: DataKey;

  private propagateChange = null;

  public dataKeyFormGroup: FormGroup;

  public dataKeySettingsFormGroup: FormGroup;

  private dataKeySettingsData: JsonFormComponentData;

  private alarmKeys: Array<DataKey>;

  filteredKeys: Observable<Array<string>>;
  private latestKeySearchResult: Array<string> = null;

  keySearchText = '';

  constructor(protected store: Store<AppState>,
              private utils: UtilsService,
              private entityService: EntityService,
              private dialog: MatDialog,
              private translate: TranslateService,
              private fb: FormBuilder) {
    super(store);
  }

  ngOnInit(): void {
    this.alarmKeys = [];
    for (const name of Object.keys(alarmFields)) {
      this.alarmKeys.push({
        name,
        type: DataKeyType.alarm
      });
    }
    if (this.dataKeySettingsSchema && this.dataKeySettingsSchema.schema) {
      this.displayAdvanced = true;
      this.dataKeySettingsData = {
        schema: this.dataKeySettingsSchema.schema,
        form: this.dataKeySettingsSchema.form || ['*']
      };
      this.dataKeySettingsFormGroup = this.fb.group({
        settings: [null, []]
      });
      this.dataKeySettingsFormGroup.valueChanges.subscribe(() => {
        this.updateModel();
      });
    }
    this.dataKeyFormGroup = this.fb.group({
      name: [null, []],
      label: [null, [Validators.required]],
      color: [null, [Validators.required]],
      units: [null, []],
      decimals: [null, [Validators.min(0), Validators.max(15), Validators.pattern(/^\d*$/)]],
      funcBody: [null, []],
      usePostProcessing: [null, []],
      postFuncBody: [null, []]
    });

    this.dataKeyFormGroup.valueChanges.subscribe(() => {
      this.updateModel();
    });

    this.dataKeyFormGroup.get('usePostProcessing').valueChanges.subscribe((usePostProcessing: boolean) => {
      const postFuncBody: string = this.dataKeyFormGroup.get('postFuncBody').value;
      if (usePostProcessing && (!postFuncBody || !postFuncBody.length)) {
        this.dataKeyFormGroup.get('postFuncBody').patchValue('return value;');
      } else if (!usePostProcessing && postFuncBody && postFuncBody.length) {
        this.dataKeyFormGroup.get('postFuncBody').patchValue(null);
      }
    });

    this.filteredKeys = this.dataKeyFormGroup.get('name').valueChanges
      .pipe(
        map(value => value ? value : ''),
        mergeMap(name => this.fetchKeys(name) )
      );
  }

  registerOnChange(fn: any): void {
    this.propagateChange = fn;
  }

  registerOnTouched(fn: any): void {
  }

  setDisabledState(isDisabled: boolean): void {
  }

  writeValue(value: DataKey): void {
    this.modelValue = value;
    this.dataKeyFormGroup.patchValue(this.modelValue, {emitEvent: false});
    this.dataKeyFormGroup.get('name').setValidators(this.modelValue.type !== DataKeyType.function ? [Validators.required] : []);
    this.dataKeyFormGroup.get('name').updateValueAndValidity({emitEvent: false});
    if (this.displayAdvanced) {
      this.dataKeySettingsData.model = this.modelValue.settings;
      this.dataKeySettingsFormGroup.patchValue({
        settings: this.dataKeySettingsData
      }, {emitEvent: false});
    }
  }

  private updateModel() {
    this.modelValue = {...this.modelValue, ...this.dataKeyFormGroup.value};
    if (this.displayAdvanced) {
      this.modelValue.settings = this.dataKeySettingsFormGroup.get('settings').value.model;
    }
    this.propagateChange(this.modelValue);
  }

  clearKey() {
    this.dataKeyFormGroup.get('name').patchValue(null, {emitEvent: true});
    setTimeout(() => {
      this.keyInput.nativeElement.blur();
      this.keyInput.nativeElement.focus();
    }, 0);
  }

  private fetchKeys(searchText?: string): Observable<Array<string>> {
    if (this.latestKeySearchResult === null || this.keySearchText !== searchText) {
      this.keySearchText = searchText;
      let fetchObservable: Observable<Array<DataKey>> = null;
      if (this.modelValue.type === DataKeyType.alarm) {
        const dataKeyFilter = this.createDataKeyFilter(this.keySearchText);
        fetchObservable = of(this.alarmKeys.filter(dataKeyFilter));
      } else {
        if (this.entityAliasId) {
          const dataKeyTypes = [this.modelValue.type];
          fetchObservable = this.callbacks.fetchEntityKeys(this.entityAliasId, this.keySearchText, dataKeyTypes);
        } else {
          fetchObservable = of([]);
        }
      }
      return fetchObservable.pipe(
        map((dataKeys) => dataKeys.map((dataKey) => dataKey.name)),
        tap(res => this.latestKeySearchResult = res)
      );
    }
    return of(this.latestKeySearchResult);
  }

  private createDataKeyFilter(query: string): (key: DataKey) => boolean {
    const lowercaseQuery = query.toLowerCase();
    return key => key.name.toLowerCase().indexOf(lowercaseQuery) === 0;
  }

  public validateOnSubmit() {
    if (this.modelValue.type === DataKeyType.function) {
      this.funcBodyEdit.validateOnSubmit();
    } else if ((this.modelValue.type === DataKeyType.timeseries ||
                this.modelValue.type === DataKeyType.attribute) && this.dataKeyFormGroup.get('usePostProcessing').value) {
      this.postFuncBodyEdit.validateOnSubmit();
    }
  }

  public validate(c: FormControl) {
    if (!this.dataKeyFormGroup.valid) {
      return {
        dataKey: {
          valid: false
        }
      };
    }
    if (this.displayAdvanced && !this.dataKeySettingsFormGroup.valid) {
      return {
        dataKeySettings: {
          valid: false
        }
      };
    }
    return null;
  }
}
