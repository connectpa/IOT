/**
 * Copyright © 2016-2020 The Thingsboard Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.thingsboard.server.dao.sql.component;

import org.springframework.stereotype.Repository;
import org.thingsboard.server.common.data.UUIDConverter;
import org.thingsboard.server.dao.model.sql.ComponentDescriptorEntity;
import org.thingsboard.server.dao.util.HsqlDao;
import org.thingsboard.server.dao.util.SqlDao;

@SqlDao
@HsqlDao
@Repository
public class HsqlComponentDescriptorInsertRepository extends AbstractComponentDescriptorInsertRepository {

    private static final String P_KEY_CONFLICT_STATEMENT = "(component_descriptor.id=I.id)";
    private static final String UNQ_KEY_CONFLICT_STATEMENT = "(component_descriptor.clazz=I.clazz)";

    private static final String INSERT_OR_UPDATE_ON_P_KEY_CONFLICT = getInsertString(P_KEY_CONFLICT_STATEMENT);
    private static final String INSERT_OR_UPDATE_ON_UNQ_KEY_CONFLICT = getInsertString(UNQ_KEY_CONFLICT_STATEMENT);

    @Override
    public ComponentDescriptorEntity saveOrUpdate(ComponentDescriptorEntity entity) {
        return saveAndGet(entity, INSERT_OR_UPDATE_ON_P_KEY_CONFLICT, INSERT_OR_UPDATE_ON_UNQ_KEY_CONFLICT);
    }

    @Override
    protected ComponentDescriptorEntity doProcessSaveOrUpdate(ComponentDescriptorEntity entity, String query) {
        getQuery(entity, query).executeUpdate();
        return entityManager.find(ComponentDescriptorEntity.class, UUIDConverter.fromTimeUUID(entity.getUuid()));
    }

    private static String getInsertString(String conflictStatement) {
        return "MERGE INTO component_descriptor USING (VALUES :id, :actions, :clazz, :configuration_descriptor, :name, :scope, :search_text, :type) I (id, actions, clazz, configuration_descriptor, name, scope, search_text, type) ON " + conflictStatement + " WHEN MATCHED THEN UPDATE SET component_descriptor.id = I.id, component_descriptor.actions = I.actions, component_descriptor.clazz = I.clazz, component_descriptor.configuration_descriptor = I.configuration_descriptor, component_descriptor.name = I.name, component_descriptor.scope = I.scope, component_descriptor.search_text = I.search_text, component_descriptor.type = I.type" +
                " WHEN NOT MATCHED THEN INSERT (id, actions, clazz, configuration_descriptor, name, scope, search_text, type) VALUES (I.id, I.actions, I.clazz, I.configuration_descriptor, I.name, I.scope, I.search_text, I.type)";
    }
}
