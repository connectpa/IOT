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

import L from 'leaflet';
import LeafletMap from '../leaflet-map';
import { UnitedMapSettings } from '../map-models';
import { WidgetContext } from '@home/models/widget-component.models';

export class HEREMap extends LeafletMap {
    constructor(ctx: WidgetContext, $container, options: UnitedMapSettings) {
        super(ctx, $container, options);
        const map = L.map($container).setView(options?.defaultCenterPosition, options?.defaultZoomLevel);
        const tileLayer = (L.tileLayer as any).provider(options.mapProviderHere || 'HERE.normalDay', options.credentials);
        tileLayer.addTo(map);
        super.setMap(map);
        super.initSettings(options);
    }
}
