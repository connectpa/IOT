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
package org.thingsboard.server.dao.sql.attributes;

import com.google.common.collect.Lists;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.thingsboard.server.common.data.UUIDConverter;
import org.thingsboard.server.common.data.id.EntityId;
import org.thingsboard.server.common.data.id.TenantId;
import org.thingsboard.server.common.data.kv.AttributeKvEntry;
import org.thingsboard.server.dao.DaoUtil;
import org.thingsboard.server.dao.attributes.AttributesDao;
import org.thingsboard.server.dao.model.sql.AttributeKvCompositeKey;
import org.thingsboard.server.dao.model.sql.AttributeKvEntity;
import org.thingsboard.server.dao.sql.JpaAbstractDaoListeningExecutorService;
import org.thingsboard.server.dao.sql.ScheduledLogExecutorComponent;
import org.thingsboard.server.dao.sql.TbSqlBlockingQueue;
import org.thingsboard.server.dao.sql.TbSqlBlockingQueueParams;
import org.thingsboard.server.dao.util.SqlDao;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

import static org.thingsboard.server.common.data.UUIDConverter.fromTimeUUID;

@Component
@Slf4j
@SqlDao
public class JpaAttributeDao extends JpaAbstractDaoListeningExecutorService implements AttributesDao {

    @Autowired
    ScheduledLogExecutorComponent logExecutor;

    @Autowired
    private AttributeKvRepository attributeKvRepository;

    @Autowired
    private AttributeKvInsertRepository attributeKvInsertRepository;

    @Value("${sql.attributes.batch_size:1000}")
    private int batchSize;

    @Value("${sql.attributes.batch_max_delay:100}")
    private long maxDelay;

    @Value("${sql.attributes.stats_print_interval_ms:1000}")
    private long statsPrintIntervalMs;

    private TbSqlBlockingQueue<AttributeKvEntity> queue;

    @PostConstruct
    private void init() {
        TbSqlBlockingQueueParams params = TbSqlBlockingQueueParams.builder()
                .logName("Attributes")
                .batchSize(batchSize)
                .maxDelay(maxDelay)
                .statsPrintIntervalMs(statsPrintIntervalMs)
                .build();
        queue = new TbSqlBlockingQueue<>(params);
        queue.init(logExecutor, v -> attributeKvInsertRepository.saveOrUpdate(v));
    }

    @PreDestroy
    private void destroy() {
        if (queue != null) {
            queue.destroy();
        }
    }

    @Override
    public ListenableFuture<Optional<AttributeKvEntry>> find(TenantId tenantId, EntityId entityId, String attributeType, String attributeKey) {
        AttributeKvCompositeKey compositeKey =
                getAttributeKvCompositeKey(entityId, attributeType, attributeKey);
        return Futures.immediateFuture(
                Optional.ofNullable(DaoUtil.getData(attributeKvRepository.findById(compositeKey))));
    }

    @Override
    public ListenableFuture<List<AttributeKvEntry>> find(TenantId tenantId, EntityId entityId, String attributeType, Collection<String> attributeKeys) {
        List<AttributeKvCompositeKey> compositeKeys =
                attributeKeys
                        .stream()
                        .map(attributeKey ->
                                getAttributeKvCompositeKey(entityId, attributeType, attributeKey))
                        .collect(Collectors.toList());
        return Futures.immediateFuture(
                DaoUtil.convertDataList(Lists.newArrayList(attributeKvRepository.findAllById(compositeKeys))));
    }

    @Override
    public ListenableFuture<List<AttributeKvEntry>> findAll(TenantId tenantId, EntityId entityId, String attributeType) {
        return Futures.immediateFuture(
                DaoUtil.convertDataList(Lists.newArrayList(
                        attributeKvRepository.findAllByEntityTypeAndEntityIdAndAttributeType(
                                entityId.getEntityType(),
                                UUIDConverter.fromTimeUUID(entityId.getId()),
                                attributeType))));
    }

    @Override
    public ListenableFuture<Void> save(TenantId tenantId, EntityId entityId, String attributeType, AttributeKvEntry attribute) {
        AttributeKvEntity entity = new AttributeKvEntity();
        entity.setId(new AttributeKvCompositeKey(entityId.getEntityType(), fromTimeUUID(entityId.getId()), attributeType, attribute.getKey()));
        entity.setLastUpdateTs(attribute.getLastUpdateTs());
        entity.setStrValue(attribute.getStrValue().orElse(null));
        entity.setDoubleValue(attribute.getDoubleValue().orElse(null));
        entity.setLongValue(attribute.getLongValue().orElse(null));
        entity.setBooleanValue(attribute.getBooleanValue().orElse(null));
        entity.setJsonValue(attribute.getJsonValue().orElse(null));
        return addToQueue(entity);
    }

    private ListenableFuture<Void> addToQueue(AttributeKvEntity entity) {
        return queue.add(entity);
    }

    @Override
    public ListenableFuture<List<Void>> removeAll(TenantId tenantId, EntityId entityId, String attributeType, List<String> keys) {
        return service.submit(() -> {
            keys.forEach(key ->
                    attributeKvRepository.delete(entityId.getEntityType(), UUIDConverter.fromTimeUUID(entityId.getId()), attributeType, key)
            );
            return null;
        });
    }

    private AttributeKvCompositeKey getAttributeKvCompositeKey(EntityId entityId, String attributeType, String attributeKey) {
        return new AttributeKvCompositeKey(
                entityId.getEntityType(),
                fromTimeUUID(entityId.getId()),
                attributeType,
                attributeKey);
    }
}
