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
package org.thingsboard.server.dao.sql.event;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.thingsboard.server.common.data.EntityType;
import org.thingsboard.server.dao.model.sql.EventEntity;
import org.thingsboard.server.dao.util.SqlDao;

import java.util.List;

/**
 * Created by Valerii Sosliuk on 5/3/2017.
 */
@SqlDao
public interface EventRepository extends PagingAndSortingRepository<EventEntity, String> {

    EventEntity findByTenantIdAndEntityTypeAndEntityIdAndEventTypeAndEventUid(String tenantId,
                                                                              EntityType entityType,
                                                                              String entityId,
                                                                              String eventType,
                                                                              String eventUid);

    EventEntity findByTenantIdAndEntityTypeAndEntityId(String tenantId,
                                                       EntityType entityType,
                                                       String entityId);

    @Query("SELECT e FROM EventEntity e WHERE e.tenantId = :tenantId AND e.entityType = :entityType " +
            "AND e.entityId = :entityId AND e.eventType = :eventType ORDER BY e.eventType DESC, e.id DESC")
    List<EventEntity> findLatestByTenantIdAndEntityTypeAndEntityIdAndEventType(
                                                    @Param("tenantId") String tenantId,
                                                    @Param("entityType") EntityType entityType,
                                                    @Param("entityId") String entityId,
                                                    @Param("eventType") String eventType,
                                                    Pageable pageable);

    @Query("SELECT e FROM EventEntity e WHERE " +
            "e.tenantId = :tenantId " +
            "AND e.entityType = :entityType AND e.entityId = :entityId " +
            "AND (:startId IS NULL OR e.id >= :startId) " +
            "AND (:endId IS NULL OR e.id <= :endId) " +
            "AND LOWER(e.eventType) LIKE LOWER(CONCAT(:textSearch, '%'))"
    )
    Page<EventEntity> findEventsByTenantIdAndEntityId(@Param("tenantId") String tenantId,
                                                      @Param("entityType") EntityType entityType,
                                                      @Param("entityId") String entityId,
                                                      @Param("textSearch") String textSearch,
                                                      @Param("startId") String startId,
                                                      @Param("endId") String endId,
                                                      Pageable pageable);

    @Query("SELECT e FROM EventEntity e WHERE " +
            "e.tenantId = :tenantId " +
            "AND e.entityType = :entityType AND e.entityId = :entityId " +
            "AND e.eventType = :eventType " +
            "AND (:startId IS NULL OR e.id >= :startId) " +
            "AND (:endId IS NULL OR e.id <= :endId)"
    )
    Page<EventEntity> findEventsByTenantIdAndEntityIdAndEventType(@Param("tenantId") String tenantId,
                                                                  @Param("entityType") EntityType entityType,
                                                                  @Param("entityId") String entityId,
                                                                  @Param("eventType") String eventType,
                                                                  @Param("startId") String startId,
                                                                  @Param("endId") String endId,
                                                                  Pageable pageable);

}
