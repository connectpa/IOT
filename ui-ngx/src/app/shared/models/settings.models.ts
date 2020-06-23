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

export const smtpPortPattern: RegExp = /^([0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/;

export interface AdminSettings<T> {
  key: string;
  jsonValue: T;
}

export declare type SmtpProtocol = 'smtp' | 'smtps';

export interface MailServerSettings {
  mailFrom: string;
  smtpProtocol: SmtpProtocol;
  smtpHost: string;
  smtpPort: number;
  timeout: number;
  enableTls: boolean;
  username: string;
  password: string;
  enableProxy: boolean;
  proxyHost: string;
  proxyPort: number;
  proxyUser: string;
  proxyPassword: string;
}

export interface GeneralSettings {
  baseUrl: string;
}

export interface UserPasswordPolicy {
  minimumLength: number;
  minimumUppercaseLetters: number;
  minimumLowercaseLetters: number;
  minimumDigits: number;
  minimumSpecialCharacters: number;
  passwordExpirationPeriodDays: number;
}

export interface SecuritySettings {
  passwordPolicy: UserPasswordPolicy;
}

export interface UpdateMessage {
  message: string;
  updateAvailable: boolean;
}
