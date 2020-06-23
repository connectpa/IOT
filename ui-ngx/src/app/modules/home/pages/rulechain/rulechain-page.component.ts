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
  AfterViewInit,
  Component,
  ElementRef,
  HostBinding,
  Inject,
  OnInit,
  QueryList,
  SkipSelf,
  ViewChild,
  ViewChildren,
  ViewEncapsulation
} from '@angular/core';
import { PageComponent } from '@shared/components/page.component';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import { FormBuilder, FormControl, FormGroup, FormGroupDirective, NgForm, Validators } from '@angular/forms';
import { HasDirtyFlag } from '@core/guards/confirm-on-exit.guard';
import { TranslateService } from '@ngx-translate/core';
import { ErrorStateMatcher } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatExpansionPanel } from '@angular/material/expansion';
import { DialogService } from '@core/services/dialog.service';
import { AuthService } from '@core/auth/auth.service';
import { ActivatedRoute, Router } from '@angular/router';
import {
  inputNodeComponent,
  NodeConnectionInfo,
  ResolvedRuleChainMetaData,
  RuleChain,
  RuleChainConnectionInfo,
  RuleChainImport,
  RuleChainMetaData,
  ruleChainNodeComponent
} from '@shared/models/rule-chain.models';
import { FcItemInfo, FlowchartConstants, NgxFlowchartComponent, UserCallbacks } from 'ngx-flowchart/dist/ngx-flowchart';
import {
  FcRuleEdge,
  FcRuleNode,
  FcRuleNodeType,
  getRuleNodeHelpLink,
  LinkLabel,
  RuleNode,
  RuleNodeComponentDescriptor,
  RuleNodeType,
  ruleNodeTypeDescriptors,
  ruleNodeTypesLibrary
} from '@shared/models/rule-node.models';
import { FcRuleNodeModel, FcRuleNodeTypeModel, RuleChainMenuContextInfo } from './rulechain-page.models';
import { RuleChainService } from '@core/http/rule-chain.service';
import { fromEvent, NEVER, Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, mergeMap, tap } from 'rxjs/operators';
import { ISearchableComponent } from '../../models/searchable-component.models';
import { deepClone } from '@core/utils';
import { RuleNodeDetailsComponent } from '@home/pages/rulechain/rule-node-details.component';
import { RuleNodeLinkComponent } from './rule-node-link.component';
import { DialogComponent } from '@shared/components/dialog.component';
import { MatMenuTrigger } from '@angular/material/menu';
import { ItemBufferService, RuleNodeConnection } from '@core/services/item-buffer.service';
import { Hotkey } from 'angular2-hotkeys';
import { EntityType } from '@shared/models/entity-type.models';
import { DebugEventType, EventType } from '@shared/models/event.models';
import Timeout = NodeJS.Timeout;

@Component({
  selector: 'tb-rulechain-page',
  templateUrl: './rulechain-page.component.html',
  styleUrls: ['./rulechain-page.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class RuleChainPageComponent extends PageComponent
  implements AfterViewInit, OnInit, HasDirtyFlag, ISearchableComponent {

  get isDirty(): boolean {
    return this.isDirtyValue || this.isImport;
  }

  @HostBinding('style.width') width = '100%';
  @HostBinding('style.height') height = '100%';

  @ViewChild('ruleNodeSearchInput') ruleNodeSearchInputField: ElementRef;

  @ViewChild('ruleChainCanvas', {static: true}) ruleChainCanvas: NgxFlowchartComponent;

  @ViewChildren('ruleNodeTypeExpansionPanels',
    {read: MatExpansionPanel}) expansionPanels: QueryList<MatExpansionPanel>;

  @ViewChild('ruleChainMenuTrigger', {static: true}) ruleChainMenuTrigger: MatMenuTrigger;

  eventTypes = EventType;

  debugEventTypes = DebugEventType;

  ruleChainMenuPosition = { x: '0px', y: '0px' };

  contextMenuEvent: MouseEvent;

  ruleNodeTypeDescriptorsMap = ruleNodeTypeDescriptors;
  ruleNodeTypesLibraryArray = ruleNodeTypesLibrary;

  isImport: boolean;
  isDirtyValue: boolean;
  isInvalid = false;

  errorTooltips: {[nodeId: string]: JQueryTooltipster.ITooltipsterInstance} = {};
  isFullscreen = false;

  selectedRuleNodeTabIndex = 0;
  editingRuleNode: FcRuleNode = null;
  isEditingRuleNode = false;
  editingRuleNodeIndex = -1;
  editingRuleNodeAllowCustomLabels = false;
  editingRuleNodeLinkLabels: {[label: string]: LinkLabel};

  @ViewChild('tbRuleNode') ruleNodeComponent: RuleNodeDetailsComponent;
  @ViewChild('tbRuleNodeLink') ruleNodeLinkComponent: RuleNodeLinkComponent;

  editingRuleNodeLink: FcRuleEdge = null;
  isEditingRuleNodeLink = false;
  editingRuleNodeLinkIndex = -1;

  hotKeys: Hotkey[] = [];

  enableHotKeys = true;
  isLibraryOpen = true;

  ruleNodeSearch = '';
  ruleNodeTypeSearch = '';

  ruleChain: RuleChain;
  ruleChainMetaData: ResolvedRuleChainMetaData;

  ruleChainModel: FcRuleNodeModel = {
    nodes: [],
    edges: []
  };
  selectedObjects = [];

  editCallbacks: UserCallbacks = {
    edgeDoubleClick: (event, edge) => {
      this.openLinkDetails(edge);
    },
    edgeEdit: (event, edge) => {
      this.openLinkDetails(edge);
    },
    nodeCallbacks: {
      doubleClick: (event, node: FcRuleNode) => {
        this.openNodeDetails(node);
      },
      nodeEdit: (event, node: FcRuleNode) => {
        this.openNodeDetails(node);
      },
      mouseEnter: this.displayNodeDescriptionTooltip.bind(this),
      mouseLeave: this.destroyTooltips.bind(this),
      mouseDown: this.destroyTooltips.bind(this)
    },
    isValidEdge: (source, destination) => {
      return source.type === FlowchartConstants.rightConnectorType && destination.type === FlowchartConstants.leftConnectorType;
    },
    createEdge: (event, edge: FcRuleEdge) => {
      const sourceNode = this.ruleChainCanvas.modelService.nodes.getNodeByConnectorId(edge.source) as FcRuleNode;
      if (sourceNode.component.type === RuleNodeType.INPUT) {
        const destNode = this.ruleChainCanvas.modelService.nodes.getNodeByConnectorId(edge.destination) as FcRuleNode;
        if (destNode.component.type === RuleNodeType.RULE_CHAIN) {
          return NEVER;
        } else {
          const found = this.ruleChainModel.edges.find(theEdge => theEdge.source === (this.inputConnectorId + ''));
          if (found) {
            this.ruleChainCanvas.modelService.edges.delete(found);
          }
          return of(edge);
        }
      } else {
        if (edge.label) {
          if (!edge.labels) {
            edge.labels = edge.label.split(' / ');
          }
          return of(edge);
        } else {
          const labels = this.ruleChainService.getRuleNodeSupportedLinks(sourceNode.component);
          const allowCustomLabels = this.ruleChainService.ruleNodeAllowCustomLinks(sourceNode.component);
          this.enableHotKeys = false;
          return this.addRuleNodeLink(edge, labels, allowCustomLabels).pipe(
            tap(() => {
                this.enableHotKeys = true;
            }),
            mergeMap((res) => {
              if (res) {
                return of(res);
              } else {
                return NEVER;
              }
            })
          );
        }
      }
    },
    dropNode: (event, node: FcRuleNode) => {
      this.addRuleNode(node);
    }
  };

  nextNodeID: number;
  nextConnectorID: number;
  inputConnectorId: number;

  ruleNodeTypesModel: {[type: string]: {model: FcRuleNodeTypeModel, selectedObjects: any[]}} = {};

  nodeLibCallbacks: UserCallbacks = {
    nodeCallbacks: {
      mouseEnter: this.displayLibNodeDescriptionTooltip.bind(this),
      mouseLeave: this.destroyTooltips.bind(this),
      mouseDown: this.destroyTooltips.bind(this)
    }
  };

  ruleNodeComponents: Array<RuleNodeComponentDescriptor>;

  flowchartConstants = FlowchartConstants;

  private tooltipTimeout: Timeout;

  constructor(protected store: Store<AppState>,
              private route: ActivatedRoute,
              private router: Router,
              private ruleChainService: RuleChainService,
              private authService: AuthService,
              private translate: TranslateService,
              private itembuffer: ItemBufferService,
              public dialog: MatDialog,
              public dialogService: DialogService,
              public fb: FormBuilder) {
    super(store);
    this.init();
  }

  ngOnInit() {
  }

  ngAfterViewInit() {
    fromEvent(this.ruleNodeSearchInputField.nativeElement, 'keyup')
      .pipe(
        debounceTime(150),
        distinctUntilChanged(),
        tap(() => {
          this.updateRuleChainLibrary();
        })
      )
      .subscribe();
    this.ruleChainCanvas.adjustCanvasSize(true);
  }

  onSearchTextUpdated(searchText: string) {
    this.ruleNodeSearch = searchText;
    this.updateRuleNodesHighlight();
  }

  private init() {
    this.initHotKeys();
    this.isImport = this.route.snapshot.data.import;
    if (this.isImport) {
      const ruleChainImport: RuleChainImport = this.itembuffer.getRuleChainImport();
      this.ruleChain = ruleChainImport.ruleChain;
      this.ruleChainMetaData = ruleChainImport.resolvedMetadata;
    } else {
      this.ruleChain = this.route.snapshot.data.ruleChain;
      this.ruleChainMetaData = this.route.snapshot.data.ruleChainMetaData;
    }
    this.ruleNodeComponents = this.route.snapshot.data.ruleNodeComponents;
    for (const type of ruleNodeTypesLibrary) {
      const desc = ruleNodeTypeDescriptors.get(type);
      if (!desc.special) {
        this.ruleNodeTypesModel[type] = {
          model: {
            nodes: [],
            edges: []
          },
          selectedObjects: []
        };
      }
    }
    this.updateRuleChainLibrary();
    this.createRuleChainModel();
  }

  private initHotKeys(): void {
    this.hotKeys.push(
      new Hotkey('ctrl+a', (event: KeyboardEvent) => {
          if (this.enableHotKeys) {
            event.preventDefault();
            this.ruleChainCanvas.modelService.selectAll();
            return false;
          }
          return true;
        }, ['INPUT', 'SELECT', 'TEXTAREA'],
        this.translate.instant('rulenode.select-all-objects'))
    );
    this.hotKeys.push(
      new Hotkey('ctrl+c', (event: KeyboardEvent) => {
          if (this.enableHotKeys) {
            event.preventDefault();
            this.copyRuleNodes();
            return false;
          }
          return true;
        }, ['INPUT', 'SELECT', 'TEXTAREA'],
        this.translate.instant('rulenode.copy-selected'))
    );
    this.hotKeys.push(
      new Hotkey('ctrl+v', (event: KeyboardEvent) => {
          if (this.enableHotKeys) {
            event.preventDefault();
            if (this.itembuffer.hasRuleNodes()) {
              this.pasteRuleNodes();
            }
            return false;
          }
          return true;
        }, ['INPUT', 'SELECT', 'TEXTAREA'],
        this.translate.instant('action.paste'))
    );
    this.hotKeys.push(
      new Hotkey('esc', (event: KeyboardEvent) => {
          if (this.enableHotKeys) {
            event.preventDefault();
            event.stopPropagation();
            this.ruleChainCanvas.modelService.deselectAll();
            return false;
          }
          return true;
        }, ['INPUT', 'SELECT', 'TEXTAREA'],
        this.translate.instant('rulenode.deselect-all-objects'))
    );
    this.hotKeys.push(
      new Hotkey('ctrl+s', (event: KeyboardEvent) => {
          if (this.enableHotKeys) {
            event.preventDefault();
            this.saveRuleChain();
            return false;
          }
          return true;
        }, ['INPUT', 'SELECT', 'TEXTAREA'],
        this.translate.instant('action.apply'))
    );
    this.hotKeys.push(
      new Hotkey('ctrl+z', (event: KeyboardEvent) => {
          if (this.enableHotKeys) {
            event.preventDefault();
            this.revertRuleChain();
            return false;
          }
          return true;
        }, ['INPUT', 'SELECT', 'TEXTAREA'],
        this.translate.instant('action.decline-changes'))
    );
    this.hotKeys.push(
      new Hotkey('del', (event: KeyboardEvent) => {
          if (this.enableHotKeys) {
            event.preventDefault();
            this.ruleChainCanvas.modelService.deleteSelected();
            return false;
          }
          return true;
        }, ['INPUT', 'SELECT', 'TEXTAREA'],
        this.translate.instant('rulenode.delete-selected-objects'))
    );
  }

  updateRuleChainLibrary() {
    const search = this.ruleNodeTypeSearch.toUpperCase();
    const res = this.ruleNodeComponents.filter(
      (ruleNodeComponent) => ruleNodeComponent.name.toUpperCase().includes(search));
    this.loadRuleChainLibrary(res);
  }

  private loadRuleChainLibrary(ruleNodeComponents: Array<RuleNodeComponentDescriptor>) {
    for (const componentType of Object.keys(this.ruleNodeTypesModel)) {
      this.ruleNodeTypesModel[componentType].model.nodes.length = 0;
    }
    ruleNodeComponents.forEach((ruleNodeComponent) => {
      const componentType = ruleNodeComponent.type;
      const model = this.ruleNodeTypesModel[componentType].model;
      const desc = ruleNodeTypeDescriptors.get(RuleNodeType[componentType]);
      let icon = desc.icon;
      let iconUrl = null;
      if (ruleNodeComponent.configurationDescriptor.nodeDefinition.icon) {
        icon = ruleNodeComponent.configurationDescriptor.nodeDefinition.icon;
      }
      if (ruleNodeComponent.configurationDescriptor.nodeDefinition.iconUrl) {
        iconUrl = ruleNodeComponent.configurationDescriptor.nodeDefinition.iconUrl;
      }
      const node: FcRuleNodeType = {
        id: 'node-lib-' + componentType + '-' + model.nodes.length,
        component: ruleNodeComponent,
        name: '',
        nodeClass: desc.nodeClass,
        icon,
        iconUrl,
        x: 30,
        y: 10 + 50 * model.nodes.length,
        connectors: []
      };
      if (ruleNodeComponent.configurationDescriptor.nodeDefinition.inEnabled) {
        node.connectors.push(
          {
            type: FlowchartConstants.leftConnectorType,
            id: (model.nodes.length * 2) + ''
          }
        );
      }
      if (ruleNodeComponent.configurationDescriptor.nodeDefinition.outEnabled) {
        node.connectors.push(
          {
            type: FlowchartConstants.rightConnectorType,
            id: (model.nodes.length * 2 + 1) + ''
          }
        );
      }
      model.nodes.push(node);
    });
    if (this.expansionPanels) {
      for (let i = 0; i < ruleNodeTypesLibrary.length; i++) {
        const panel = this.expansionPanels.find((item, index) => {
          return index === i;
        });
        if (panel) {
          const type = ruleNodeTypesLibrary[i];
          if (!this.ruleNodeTypesModel[type].model.nodes.length) {
            panel.close();
          } else {
            panel.open();
          }
        }
      }
    }
  }

  private createRuleChainModel() {
    this.nextNodeID = 1;
    this.nextConnectorID = 1;

    this.selectedObjects = [];
    this.ruleChainModel.nodes = [];
    this.ruleChainModel.edges = [];

    this.inputConnectorId = this.nextConnectorID++;
    this.ruleChainModel.nodes.push(
      {
        id: 'rule-chain-node-' + this.nextNodeID++,
        component: inputNodeComponent,
        name: '',
        nodeClass: ruleNodeTypeDescriptors.get(RuleNodeType.INPUT).nodeClass,
        icon: ruleNodeTypeDescriptors.get(RuleNodeType.INPUT).icon,
        readonly: true,
        x: 50,
        y: 150,
        connectors: [
          {
            type: FlowchartConstants.rightConnectorType,
            id: this.inputConnectorId + ''
          },
        ]

      }
    );
    const nodes: FcRuleNode[] = [];
    this.ruleChainMetaData.nodes.forEach((ruleNode) => {
      const component = this.ruleChainService.getRuleNodeComponentByClazz(ruleNode.type);
      const descriptor = ruleNodeTypeDescriptors.get(component.type);
      let icon = descriptor.icon;
      let iconUrl = null;
      if (component.configurationDescriptor.nodeDefinition.icon) {
        icon = component.configurationDescriptor.nodeDefinition.icon;
      }
      if (component.configurationDescriptor.nodeDefinition.iconUrl) {
        iconUrl = component.configurationDescriptor.nodeDefinition.iconUrl;
      }
      const node: FcRuleNode = {
        id: 'rule-chain-node-' + this.nextNodeID++,
        ruleNodeId: ruleNode.id,
        additionalInfo: ruleNode.additionalInfo,
        configuration: ruleNode.configuration,
        debugMode: ruleNode.debugMode,
        x: Math.round(ruleNode.additionalInfo.layoutX),
        y: Math.round(ruleNode.additionalInfo.layoutY),
        component,
        name: ruleNode.name,
        nodeClass: descriptor.nodeClass,
        icon,
        iconUrl,
        connectors: []
      };
      if (component.configurationDescriptor.nodeDefinition.inEnabled) {
        node.connectors.push(
          {
            type: FlowchartConstants.leftConnectorType,
            id: (this.nextConnectorID++) + ''
          }
        );
      }
      if (component.configurationDescriptor.nodeDefinition.outEnabled) {
        node.connectors.push(
          {
            type: FlowchartConstants.rightConnectorType,
            id: (this.nextConnectorID++) + ''
          }
        );
      }
      nodes.push(node);
      this.ruleChainModel.nodes.push(node);
    });
    if (this.ruleChainMetaData.firstNodeIndex > -1) {
      const destNode = nodes[this.ruleChainMetaData.firstNodeIndex];
      if (destNode) {
        const connectors = destNode.connectors.filter(connector => connector.type === FlowchartConstants.leftConnectorType);
        if (connectors && connectors.length) {
          const edge: FcRuleEdge = {
            source: this.inputConnectorId + '',
            destination: connectors[0].id
          };
          this.ruleChainModel.edges.push(edge);
        }
      }
    }
    if (this.ruleChainMetaData.connections) {
      const edgeMap: {[edgeKey: string]: FcRuleEdge} = {};
      this.ruleChainMetaData.connections.forEach((connection) => {
        const sourceNode = nodes[connection.fromIndex];
        const destNode = nodes[connection.toIndex];
        if (sourceNode && destNode) {
          const sourceConnectors = sourceNode.connectors.filter(connector => connector.type === FlowchartConstants.rightConnectorType);
          const destConnectors = destNode.connectors.filter(connector => connector.type === FlowchartConstants.leftConnectorType);
          if (sourceConnectors && sourceConnectors.length && destConnectors && destConnectors.length) {
            const sourceId = sourceConnectors[0].id;
            const destId = destConnectors[0].id;
            const edgeKey = sourceId + '_' + destId;
            let edge = edgeMap[edgeKey];
            if (!edge) {
              edge = {
                source: sourceId,
                destination: destId,
                label: connection.type,
                labels: [connection.type]
              };
              edgeMap[edgeKey] = edge;
              this.ruleChainModel.edges.push(edge);
            } else {
              edge.label += ' / ' + connection.type;
              edge.labels.push(connection.type);
            }
          }
        }
      });
    }
    if (this.ruleChainMetaData.ruleChainConnections) {
      const ruleChainsMap = this.ruleChainMetaData.targetRuleChainsMap;
      const ruleChainNodesMap: {[ruleChainNodeId: string]: FcRuleNode} = {};
      const ruleChainEdgeMap: {[edgeKey: string]: FcRuleEdge} = {};
      this.ruleChainMetaData.ruleChainConnections.forEach((ruleChainConnection) => {
        const ruleChain = ruleChainsMap[ruleChainConnection.targetRuleChainId.id];
        if (ruleChainConnection.additionalInfo && ruleChainConnection.additionalInfo.ruleChainNodeId) {
          let ruleChainNode = ruleChainNodesMap[ruleChainConnection.additionalInfo.ruleChainNodeId];
          if (!ruleChainNode) {
            ruleChainNode = {
              id: 'rule-chain-node-' + this.nextNodeID++,
              name: ruleChain.name ? ruleChain.name : 'Unresolved',
              targetRuleChainId: ruleChain.name ? ruleChainConnection.targetRuleChainId.id : null,
              error: ruleChain.name ? undefined : this.translate.instant('rulenode.invalid-target-rulechain'),
              additionalInfo: ruleChainConnection.additionalInfo,
              x: Math.round(ruleChainConnection.additionalInfo.layoutX),
              y: Math.round(ruleChainConnection.additionalInfo.layoutY),
              component: ruleChainNodeComponent,
              nodeClass: ruleNodeTypeDescriptors.get(RuleNodeType.RULE_CHAIN).nodeClass,
              icon: ruleNodeTypeDescriptors.get(RuleNodeType.RULE_CHAIN).icon,
              connectors: [
                {
                  type: FlowchartConstants.leftConnectorType,
                  id: (this.nextConnectorID++) + ''
                }
              ]
            };
            ruleChainNodesMap[ruleChainConnection.additionalInfo.ruleChainNodeId] = ruleChainNode;
            this.ruleChainModel.nodes.push(ruleChainNode);
          }
          const sourceNode = nodes[ruleChainConnection.fromIndex];
          if (sourceNode) {
            const connectors = sourceNode.connectors.filter(connector => connector.type === FlowchartConstants.rightConnectorType);
            if (connectors && connectors.length) {
              const sourceId = connectors[0].id;
              const destId = ruleChainNode.connectors[0].id;
              const edgeKey = sourceId + '_' + destId;
              let ruleChainEdge = ruleChainEdgeMap[edgeKey];
              if (!ruleChainEdge) {
                ruleChainEdge = {
                  source: sourceId,
                  destination: destId,
                  label: ruleChainConnection.type,
                  labels: [ruleChainConnection.type]
                };
                ruleChainEdgeMap[edgeKey] = ruleChainEdge;
                this.ruleChainModel.edges.push(ruleChainEdge);
              } else {
                ruleChainEdge.label += ' / ' + ruleChainConnection.type;
                ruleChainEdge.labels.push(ruleChainConnection.type);
              }
            }
          }
        }
      });
    }
    if (this.ruleChainCanvas) {
      this.ruleChainCanvas.adjustCanvasSize(true);
    }
    this.isDirtyValue = false;
    this.updateRuleNodesHighlight();
    this.validate();
  }

  openRuleChainContextMenu($event: MouseEvent) {
    if (this.ruleChainCanvas.modelService && !$event.ctrlKey && !$event.metaKey) {
      const x = $event.clientX;
      const y = $event.clientY;
      const item = this.ruleChainCanvas.modelService.getItemInfoAtPoint(x, y);
      const contextInfo = this.prepareContextMenu(item);
      if (contextInfo.menuItems && contextInfo.menuItems.length > 0) {
        $event.preventDefault();
        $event.stopPropagation();
        this.contextMenuEvent = $event;
        this.ruleChainMenuPosition.x = x + 'px';
        this.ruleChainMenuPosition.y = y + 'px';
        this.ruleChainMenuTrigger.menuData = { contextInfo };
        this.ruleChainMenuTrigger.openMenu();
      }
    }
  }

  onRuleChainContextMenuMouseLeave() {
    this.ruleChainMenuTrigger.closeMenu();
  }

  private prepareContextMenu(item: FcItemInfo): RuleChainMenuContextInfo {
    if (this.objectsSelected() || (!item.node && !item.edge)) {
      return this.prepareRuleChainContextMenu();
    } else if (item.node) {
      return this.prepareRuleNodeContextMenu(item.node);
    } else if (item.edge) {
      return this.prepareEdgeContextMenu(item.edge);
    }
  }

  private prepareRuleChainContextMenu(): RuleChainMenuContextInfo {
    const contextInfo: RuleChainMenuContextInfo = {
      headerClass: 'tb-rulechain-header',
      icon: 'settings_ethernet',
      title: this.ruleChain.name,
      subtitle: this.translate.instant('rulechain.rulechain'),
      menuItems: []
    };
    if (this.ruleChainCanvas.modelService.nodes.getSelectedNodes().length) {
      contextInfo.menuItems.push(
        {
          action: () => {
            this.copyRuleNodes();
          },
          enabled: true,
          value: 'rulenode.copy-selected',
          icon: 'content_copy',
          shortcut: 'M-C'
        }
      );
    }
    contextInfo.menuItems.push(
      {
        action: ($event) => {
          this.pasteRuleNodes($event);
        },
        enabled: this.itembuffer.hasRuleNodes(),
        value: 'action.paste',
        icon: 'content_paste',
        shortcut: 'M-V'
      }
    );
    contextInfo.menuItems.push(
      {
        divider: true
      }
    );
    if (this.objectsSelected()) {
      contextInfo.menuItems.push(
        {
          action: () => {
            this.ruleChainCanvas.modelService.deselectAll();
          },
          enabled: true,
          value: 'rulenode.deselect-all',
          icon: 'tab_unselected',
          shortcut: 'Esc'
        }
      );
      contextInfo.menuItems.push(
        {
          action: () => {
            this.ruleChainCanvas.modelService.deleteSelected();
          },
          enabled: true,
          value: 'rulenode.delete-selected',
          icon: 'clear',
          shortcut: 'Del'
        }
      );
    } else {
      contextInfo.menuItems.push(
        {
          action: () => {
            this.ruleChainCanvas.modelService.selectAll();
          },
          enabled: true,
          value: 'rulenode.select-all',
          icon: 'select_all',
          shortcut: 'M-A'
        }
      );
    }
    contextInfo.menuItems.push(
      {
        divider: true
      }
    );
    contextInfo.menuItems.push(
      {
        action: () => {
          this.saveRuleChain();
        },
        enabled: !(this.isInvalid || (!this.isDirty && !this.isImport)),
        value: 'action.apply-changes',
        icon: 'done',
        shortcut: 'M-S'
      }
    );
    contextInfo.menuItems.push(
      {
        action: () => {
          this.revertRuleChain();
        },
        enabled: this.isDirty,
        value: 'action.decline-changes',
        icon: 'close',
        shortcut: 'M-Z'
      }
    );
    return contextInfo;
  }

  private prepareRuleNodeContextMenu(node: FcRuleNode): RuleChainMenuContextInfo {
    const contextInfo: RuleChainMenuContextInfo = {
      headerClass: node.nodeClass,
      icon: node.icon,
      iconUrl: node.iconUrl,
      title: node.name,
      subtitle: node.component.name,
      menuItems: []
    };
    if (!node.readonly) {
      contextInfo.menuItems.push(
        {
          action: () => {
            this.openNodeDetails(node);
          },
          enabled: true,
          value: 'rulenode.details',
          icon: 'menu'
        }
      );
      contextInfo.menuItems.push(
        {
          action: () => {
            this.copyNode(node);
          },
          enabled: true,
          value: 'action.copy',
          icon: 'content_copy'
        }
      );
      contextInfo.menuItems.push(
        {
          action: () => {
            this.ruleChainCanvas.modelService.nodes.delete(node);
          },
          enabled: true,
          value: 'action.delete',
          icon: 'clear',
          shortcut: 'M-X'
        }
      );
    }
    return contextInfo;
  }

  private prepareEdgeContextMenu(edge: FcRuleEdge): RuleChainMenuContextInfo {
    const contextInfo: RuleChainMenuContextInfo = {
      headerClass: 'tb-link-header',
      icon: 'trending_flat',
      title: edge.label,
      subtitle: this.translate.instant('rulenode.link'),
      menuItems: []
    };
    const sourceNode: FcRuleNode = this.ruleChainCanvas.modelService.nodes.getNodeByConnectorId(edge.source);
    if (sourceNode.component.type !== RuleNodeType.INPUT) {
      contextInfo.menuItems.push(
        {
          action: () => {
            this.openLinkDetails(edge);
          },
          enabled: true,
          value: 'rulenode.details',
          icon: 'menu'
        }
      );
    }
    contextInfo.menuItems.push(
      {
        action: () => {
          this.ruleChainCanvas.modelService.edges.delete(edge);
        },
        enabled: true,
        value: 'action.delete',
        icon: 'clear',
        shortcut: 'M-X'
      }
    );
    return contextInfo;
  }

  onModelChanged() {
    this.isDirtyValue = true;
    this.validate();
  }

  helpLinkIdForRuleNodeType(): string {
    let component: RuleNodeComponentDescriptor = null;
    if (this.editingRuleNode) {
      component = this.editingRuleNode.component;
    }
    return getRuleNodeHelpLink(component);
  }

  openNodeDetails(node: FcRuleNode) {
    if (node.component.type !== RuleNodeType.INPUT) {
      this.enableHotKeys = false;
      this.updateErrorTooltips(true);
      this.isEditingRuleNodeLink = false;
      this.editingRuleNodeLink = null;
      this.isEditingRuleNode = true;
      this.editingRuleNodeIndex = this.ruleChainModel.nodes.indexOf(node);
      this.editingRuleNode = deepClone(node, ['component']);
      setTimeout(() => {
        this.ruleNodeComponent.ruleNodeFormGroup.markAsPristine();
      }, 0);
    }
  }

  openLinkDetails(edge: FcRuleEdge) {
    const sourceNode: FcRuleNode = this.ruleChainCanvas.modelService.nodes.getNodeByConnectorId(edge.source) as FcRuleNode;
    if (sourceNode.component.type !== RuleNodeType.INPUT) {
      this.enableHotKeys = false;
      this.updateErrorTooltips(true);
      this.isEditingRuleNode = false;
      this.editingRuleNode = null;
      this.editingRuleNodeLinkLabels = this.ruleChainService.getRuleNodeSupportedLinks(sourceNode.component);
      this.editingRuleNodeAllowCustomLabels = this.ruleChainService.ruleNodeAllowCustomLinks(sourceNode.component);
      this.isEditingRuleNodeLink = true;
      this.editingRuleNodeLinkIndex = this.ruleChainModel.edges.indexOf(edge);
      this.editingRuleNodeLink = deepClone(edge);
      setTimeout(() => {
        this.ruleNodeLinkComponent.ruleNodeLinkFormGroup.markAsPristine();
      }, 0);
    }
  }

  private copyNode(node: FcRuleNode) {
    this.itembuffer.copyRuleNodes([node], []);
  }

  private copyRuleNodes() {
    const nodes: FcRuleNode[] = this.ruleChainCanvas.modelService.nodes.getSelectedNodes();
    const edges: FcRuleEdge[] = this.ruleChainCanvas.modelService.edges.getSelectedEdges();
    const connections: RuleNodeConnection[] = [];
    edges.forEach((edge) => {
      const sourceNode = this.ruleChainCanvas.modelService.nodes.getNodeByConnectorId(edge.source);
      const destNode = this.ruleChainCanvas.modelService.nodes.getNodeByConnectorId(edge.destination);
      const isInputSource = sourceNode.component.type === RuleNodeType.INPUT;
      const fromIndex = nodes.indexOf(sourceNode);
      const toIndex = nodes.indexOf(destNode);
      if ( (isInputSource || fromIndex > -1) && toIndex > -1 ) {
        const connection: RuleNodeConnection = {
          isInputSource,
          fromIndex,
          toIndex,
          label: edge.label,
          labels: edge.labels
        };
        connections.push(connection);
      }
    });
    this.itembuffer.copyRuleNodes(nodes, connections);
  }

  private pasteRuleNodes(event?: MouseEvent) {
    const canvas = $(this.ruleChainCanvas.modelService.canvasHtmlElement);
    let x: number;
    let y: number;
    if (event) {
      const offset = canvas.offset();
      x = Math.round(event.clientX - offset.left);
      y = Math.round(event.clientY - offset.top);
    } else {
      const scrollParent = canvas.parent();
      const scrollTop = scrollParent.scrollTop();
      const scrollLeft = scrollParent.scrollLeft();
      x = scrollLeft + scrollParent.width() / 2;
      y = scrollTop + scrollParent.height() / 2;
    }
    const ruleNodes = this.itembuffer.pasteRuleNodes(x, y);
    if (ruleNodes) {
      this.ruleChainCanvas.modelService.deselectAll();
      const nodes: FcRuleNode[] = [];
      ruleNodes.nodes.forEach((node) => {
        node.id = 'rule-chain-node-' + this.nextNodeID++;
        const component = node.component;
        if (component.configurationDescriptor.nodeDefinition.inEnabled) {
          node.connectors.push(
            {
              type: FlowchartConstants.leftConnectorType,
              id: (this.nextConnectorID++) + ''
            }
          );
        }
        if (component.configurationDescriptor.nodeDefinition.outEnabled) {
          node.connectors.push(
            {
              type: FlowchartConstants.rightConnectorType,
              id: (this.nextConnectorID++) + ''
            }
          );
        }
        nodes.push(node);
        this.ruleChainModel.nodes.push(node);
        this.ruleChainCanvas.modelService.nodes.select(node);
      });
      ruleNodes.connections.forEach((connection) => {
        const sourceNode = nodes[connection.fromIndex];
        const destNode = nodes[connection.toIndex];
        if ( (connection.isInputSource || sourceNode) &&  destNode ) {
          let source: string;
          let destination: string;
          if (connection.isInputSource) {
            source = this.inputConnectorId + '';
            const found = this.ruleChainModel.edges.find(theEdge => theEdge.source === (this.inputConnectorId + ''));
            if (found) {
              this.ruleChainCanvas.modelService.edges.delete(found);
            }
          } else {
            const sourceConnectors = this.ruleChainCanvas.modelService.nodes
              .getConnectorsByType(sourceNode, FlowchartConstants.rightConnectorType);
            if (sourceConnectors && sourceConnectors.length) {
              source = sourceConnectors[0].id;
            }
          }
          const destConnectors = this.ruleChainCanvas.modelService.nodes
            .getConnectorsByType(destNode, FlowchartConstants.leftConnectorType);
          if (destConnectors && destConnectors.length) {
            destination = destConnectors[0].id;
          }
          if (source && destination) {
            const edge: FcRuleEdge = {
              source,
              destination,
              label: connection.label,
              labels: connection.labels
            };
            this.ruleChainModel.edges.push(edge);
            this.ruleChainCanvas.modelService.edges.select(edge);
          }
        }
      });
      this.updateRuleNodesHighlight();
      this.validate();
      this.onModelChanged();
    }
  }

  onDetailsDrawerClosed() {
    this.onEditRuleNodeClosed();
    this.onEditRuleNodeLinkClosed();
    this.enableHotKeys = true;
    this.updateErrorTooltips(false);
  }

  onEditRuleNodeClosed() {
    this.editingRuleNode = null;
    this.isEditingRuleNode = false;
  }

  onEditRuleNodeLinkClosed() {
    this.editingRuleNodeLink = null;
    this.isEditingRuleNodeLink = false;
  }

  onRevertRuleNodeEdit() {
    this.ruleNodeComponent.ruleNodeFormGroup.markAsPristine();
    const node = this.ruleChainModel.nodes[this.editingRuleNodeIndex];
    this.editingRuleNode = deepClone(node, ['component']);
  }

  onRevertRuleNodeLinkEdit() {
    this.ruleNodeLinkComponent.ruleNodeLinkFormGroup.markAsPristine();
    const edge = this.ruleChainModel.edges[this.editingRuleNodeLinkIndex];
    this.editingRuleNodeLink = deepClone(edge);
  }

  saveRuleNode() {
    this.ruleNodeComponent.validate();
    if (this.ruleNodeComponent.ruleNodeFormGroup.valid) {
      this.ruleNodeComponent.ruleNodeFormGroup.markAsPristine();
      if (this.editingRuleNode.error) {
        delete this.editingRuleNode.error;
      }
      this.ruleChainModel.nodes[this.editingRuleNodeIndex] = this.editingRuleNode;
      this.editingRuleNode = deepClone(this.editingRuleNode, ['component']);
      this.onModelChanged();
      this.updateRuleNodesHighlight();
    }
  }

  saveRuleNodeLink() {
    this.ruleNodeLinkComponent.ruleNodeLinkFormGroup.markAsPristine();
    this.ruleChainModel.edges[this.editingRuleNodeLinkIndex] = this.editingRuleNodeLink;
    this.editingRuleNodeLink = deepClone(this.editingRuleNodeLink);
    this.onModelChanged();
  }

  typeHeaderMouseEnter(event: MouseEvent, ruleNodeType: RuleNodeType) {
    const type = ruleNodeTypeDescriptors.get(ruleNodeType);
    this.displayTooltip(event,
      '<div class="tb-rule-node-tooltip tb-lib-tooltip">' +
      '<div id="tb-node-content" layout="column">' +
      '<div class="tb-node-title">' + this.translate.instant(type.name) + '</div>' +
      '<div class="tb-node-details">' + this.translate.instant(type.details) + '</div>' +
      '</div>' +
      '</div>'
    );
  }

  displayLibNodeDescriptionTooltip(event: MouseEvent, node: FcRuleNodeType) {
    this.displayTooltip(event,
      '<div class="tb-rule-node-tooltip tb-lib-tooltip">' +
      '<div id="tb-node-content" layout="column">' +
      '<div class="tb-node-title">' + node.component.name + '</div>' +
      '<div class="tb-node-description">' + node.component.configurationDescriptor.nodeDefinition.description + '</div>' +
      '<div class="tb-node-details">' + node.component.configurationDescriptor.nodeDefinition.details + '</div>' +
      '</div>' +
      '</div>'
    );
  }

  displayNodeDescriptionTooltip(event: MouseEvent, node: FcRuleNode) {
    if (!this.errorTooltips[node.id]) {
      let name: string;
      let desc: string;
      let details: string;
      if (node.component.type === RuleNodeType.INPUT) {
        name = this.translate.instant(ruleNodeTypeDescriptors.get(RuleNodeType.INPUT).name);
        desc = this.translate.instant(ruleNodeTypeDescriptors.get(RuleNodeType.INPUT).details);
      } else {
        name = node.name;
        desc = this.translate.instant(ruleNodeTypeDescriptors.get(node.component.type).name) + ' - ' + node.component.name;
        if (node.additionalInfo) {
          details = node.additionalInfo.description;
        }
      }
      let tooltipContent = '<div class="tb-rule-node-tooltip">' +
        '<div id="tb-node-content" layout="column">' +
        '<div class="tb-node-title">' + name + '</div>' +
        '<div class="tb-node-description">' + desc + '</div>';
      if (details) {
        tooltipContent += '<div class="tb-node-details">' + details + '</div>';
      }
      tooltipContent += '</div>' +
        '</div>';
      this.displayTooltip(event, tooltipContent);
    }
  }

  destroyTooltips() {
    if (this.tooltipTimeout) {
      clearTimeout(this.tooltipTimeout);
      this.tooltipTimeout = null;
    }
    const instances = $.tooltipster.instances();
    instances.forEach((instance) => {
      if (!instance.isErrorTooltip) {
        instance.destroy();
      }
    });
  }

  private updateRuleNodesHighlight() {
    for (const ruleNode of this.ruleChainModel.nodes) {
      ruleNode.highlighted = false;
    }
    if (this.ruleNodeSearch) {
      const search = this.ruleNodeSearch.toUpperCase();
      const res = this.ruleChainModel.nodes.filter(node => node.name.toUpperCase().includes(search));
      if (res) {
        for (const ruleNode of res) {
          ruleNode.highlighted = true;
        }
      }
    }
    if (this.ruleChainCanvas) {
      this.ruleChainCanvas.modelService.detectChanges();
    }
  }

  objectsSelected(): boolean {
    return this.ruleChainCanvas.modelService.nodes.getSelectedNodes().length > 0 ||
      this.ruleChainCanvas.modelService.edges.getSelectedEdges().length > 0;
  }

  deleteSelected() {
    this.ruleChainCanvas.modelService.deleteSelected();
  }

  isDebugModeEnabled(): boolean {
    const res = this.ruleChainModel.nodes.find((node) => node.debugMode);
    return typeof res !== 'undefined';
  }

  resetDebugModeInAllNodes() {
    let changed = false;
    this.ruleChainModel.nodes.forEach((node) => {
      if (node.component.type !== RuleNodeType.INPUT && node.component.type !== RuleNodeType.RULE_CHAIN) {
        changed = changed || node.debugMode;
        node.debugMode = false;
      }
    });
    if (changed) {
      this.onModelChanged();
    }
  }

  validate() {
    setTimeout(() => {
      this.isInvalid = false;
      this.ruleChainModel.nodes.forEach((node) => {
        if (node.error) {
          this.isInvalid = true;
        }
        this.updateNodeErrorTooltip(node);
      });
    }, 0);
  }

  saveRuleChain() {
    let saveRuleChainObservable: Observable<RuleChain>;
    if (this.isImport) {
      saveRuleChainObservable = this.ruleChainService.saveRuleChain(this.ruleChain);
    } else {
      saveRuleChainObservable = of(this.ruleChain);
    }
    saveRuleChainObservable.subscribe((ruleChain) => {
      this.ruleChain = ruleChain;
      const ruleChainMetaData: RuleChainMetaData = {
        ruleChainId: this.ruleChain.id,
        nodes: [],
        connections: [],
        ruleChainConnections: []
      };
      const nodes: FcRuleNode[] = [];
      this.ruleChainModel.nodes.forEach((node) => {
        if (node.component.type !== RuleNodeType.INPUT && node.component.type !== RuleNodeType.RULE_CHAIN) {
          const ruleNode: RuleNode = {
            id: node.ruleNodeId,
            type: node.component.clazz,
            name: node.name,
            configuration: node.configuration,
            additionalInfo: node.additionalInfo ? node.additionalInfo : {},
            debugMode: node.debugMode
          };
          ruleNode.additionalInfo.layoutX = Math.round(node.x);
          ruleNode.additionalInfo.layoutY = Math.round(node.y);
          ruleChainMetaData.nodes.push(ruleNode);
          nodes.push(node);
        }
      });
      const firstNodeEdge = this.ruleChainModel.edges.find((edge) => edge.source === this.inputConnectorId + '');
      if (firstNodeEdge) {
        const firstNode = this.ruleChainCanvas.modelService.nodes.getNodeByConnectorId(firstNodeEdge.destination);
        ruleChainMetaData.firstNodeIndex = nodes.indexOf(firstNode);
      }
      this.ruleChainModel.edges.forEach((edge) => {
        const sourceNode = this.ruleChainCanvas.modelService.nodes.getNodeByConnectorId(edge.source);
        const destNode = this.ruleChainCanvas.modelService.nodes.getNodeByConnectorId(edge.destination);
        if (sourceNode.component.type !== RuleNodeType.INPUT) {
          const fromIndex = nodes.indexOf(sourceNode);
          if (destNode.component.type === RuleNodeType.RULE_CHAIN) {
            const ruleChainConnection = {
              fromIndex,
              targetRuleChainId: {entityType: EntityType.RULE_CHAIN, id: destNode.targetRuleChainId},
              additionalInfo: destNode.additionalInfo ? destNode.additionalInfo : {}
            } as RuleChainConnectionInfo;
            ruleChainConnection.additionalInfo.layoutX = Math.round(destNode.x);
            ruleChainConnection.additionalInfo.layoutY = Math.round(destNode.y);
            ruleChainConnection.additionalInfo.ruleChainNodeId = destNode.id;
            edge.labels.forEach((label) => {
              const newRuleChainConnection = deepClone(ruleChainConnection);
              newRuleChainConnection.type = label;
              ruleChainMetaData.ruleChainConnections.push(newRuleChainConnection);
            });
          } else {
            const toIndex = nodes.indexOf(destNode);
            const nodeConnection = {
              fromIndex,
              toIndex
            } as NodeConnectionInfo;
            edge.labels.forEach((label) => {
              const newNodeConnection = deepClone(nodeConnection);
              newNodeConnection.type = label;
              ruleChainMetaData.connections.push(newNodeConnection);
            });
          }
        }
      });
      this.ruleChainService.saveAndGetResolvedRuleChainMetadata(ruleChainMetaData).subscribe((savedRuleChainMetaData) => {
        this.ruleChainMetaData = savedRuleChainMetaData;
        if (this.isImport) {
          this.isDirtyValue = false;
          this.isImport = false;
          this.router.navigateByUrl(`ruleChains/${this.ruleChain.id.id}`);
        } else {
          this.createRuleChainModel();
        }
      });
    });
  }

  revertRuleChain() {
    this.createRuleChainModel();
  }

  addRuleNode(ruleNode: FcRuleNode) {
    ruleNode.configuration = deepClone(ruleNode.component.configurationDescriptor.nodeDefinition.defaultConfiguration);
    const ruleChainId = this.ruleChain.id ? this.ruleChain.id.id : null;
    this.enableHotKeys = false;
    this.dialog.open<AddRuleNodeDialogComponent, AddRuleNodeDialogData,
      FcRuleNode>(AddRuleNodeDialogComponent, {
      disableClose: true,
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
      data: {
        ruleNode,
        ruleChainId
      }
    }).afterClosed().subscribe(
      (addedRuleNode) => {
        if (addedRuleNode) {
          addedRuleNode.id = 'rule-chain-node-' + this.nextNodeID++;
          addedRuleNode.connectors = [];
          if (addedRuleNode.component.configurationDescriptor.nodeDefinition.inEnabled) {
            addedRuleNode.connectors.push(
              {
                id: (this.nextConnectorID++) + '',
                type: FlowchartConstants.leftConnectorType
              }
            );
          }
          if (addedRuleNode.component.configurationDescriptor.nodeDefinition.outEnabled) {
            addedRuleNode.connectors.push(
              {
                id: (this.nextConnectorID++) + '',
                type: FlowchartConstants.rightConnectorType
              }
            );
          }
          this.ruleChainModel.nodes.push(addedRuleNode);
          this.onModelChanged();
          this.updateRuleNodesHighlight();
        }
        this.enableHotKeys = true;
      }
    );
  }

  addRuleNodeLink(link: FcRuleEdge, labels: {[label: string]: LinkLabel}, allowCustomLabels: boolean): Observable<FcRuleEdge> {
    return this.dialog.open<AddRuleNodeLinkDialogComponent, AddRuleNodeLinkDialogData,
      FcRuleEdge>(AddRuleNodeLinkDialogComponent, {
      disableClose: true,
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
      data: {
        link,
        labels,
        allowCustomLabels
      }
    }).afterClosed();
  }

  private updateNodeErrorTooltip(node: FcRuleNode) {
    if (node.error) {
      const element = $('#' + node.id);
      let tooltip = this.errorTooltips[node.id];
      if (!tooltip || !element.hasClass('tooltipstered')) {
        element.tooltipster(
          {
            theme: 'tooltipster-shadow',
            delay: 0,
            animationDuration: 0,
            trigger: 'custom',
            triggerOpen: {
              click: false,
              tap: false
            },
            triggerClose: {
              click: false,
              tap: false,
              scroll: false
            },
            side: 'top',
            trackOrigin: true
          }
        );
        const content = '<div class="tb-rule-node-error-tooltip">' +
          '<div id="tooltip-content" layout="column">' +
          '<div class="tb-node-details">' + node.error + '</div>' +
          '</div>' +
          '</div>';
        const contentElement = $(content);
        tooltip = element.tooltipster('instance');
        tooltip.isErrorTooltip = true;
        tooltip.content(contentElement);
        this.errorTooltips[node.id] = tooltip;
      }
      setTimeout(() => {
        tooltip.open();
      }, 0);
    } else {
      if (this.errorTooltips[node.id]) {
        const tooltip = this.errorTooltips[node.id];
        tooltip.destroy();
        delete this.errorTooltips[node.id];
      }
    }
  }

  private updateErrorTooltips(hide: boolean) {
    for (const nodeId of Object.keys(this.errorTooltips)) {
      const tooltip = this.errorTooltips[nodeId];
      if (hide) {
        tooltip.close();
      } else {
        tooltip.open();
      }
    }
  }

  private displayTooltip(event: MouseEvent, content: string) {
    this.destroyTooltips();
    this.tooltipTimeout = setTimeout(() => {
      const element = $(event.target);
      element.tooltipster(
        {
          theme: 'tooltipster-shadow',
          delay: 100,
          trigger: 'custom',
          triggerOpen: {
            click: false,
            tap: false
          },
          triggerClose: {
            click: true,
            tap: true,
            scroll: true
          },
          side: 'right',
          trackOrigin: true
        }
      );
      const contentElement = $(content);
      const tooltip = element.tooltipster('instance');
      tooltip.content(contentElement);
      tooltip.open();
    }, 500);
  }
}

export interface AddRuleNodeLinkDialogData {
  link: FcRuleEdge;
  labels: {[label: string]: LinkLabel};
  allowCustomLabels: boolean;
}

@Component({
  selector: 'tb-add-rule-node-link-dialog',
  templateUrl: './add-rule-node-link-dialog.component.html',
  providers: [{provide: ErrorStateMatcher, useExisting: AddRuleNodeLinkDialogComponent}],
  styleUrls: ['./add-rule-node-link-dialog.component.scss']
})
export class AddRuleNodeLinkDialogComponent extends DialogComponent<AddRuleNodeLinkDialogComponent, FcRuleEdge>
  implements OnInit, ErrorStateMatcher {

  ruleNodeLinkFormGroup: FormGroup;

  link: FcRuleEdge;
  labels: {[label: string]: LinkLabel};
  allowCustomLabels: boolean;

  submitted = false;

  constructor(protected store: Store<AppState>,
              protected router: Router,
              @Inject(MAT_DIALOG_DATA) public data: AddRuleNodeLinkDialogData,
              @SkipSelf() private errorStateMatcher: ErrorStateMatcher,
              public dialogRef: MatDialogRef<AddRuleNodeLinkDialogComponent, FcRuleEdge>,
              private fb: FormBuilder) {
    super(store, router, dialogRef);

    this.link = this.data.link;
    this.labels = this.data.labels;
    this.allowCustomLabels = this.data.allowCustomLabels;

    this.ruleNodeLinkFormGroup = this.fb.group({
        link: [deepClone(this.link), [Validators.required]]
      }
    );
  }

  ngOnInit(): void {
  }

  isErrorState(control: FormControl | null, form: FormGroupDirective | NgForm | null): boolean {
    const originalErrorState = this.errorStateMatcher.isErrorState(control, form);
    const customErrorState = !!(control && control.invalid && this.submitted);
    return originalErrorState || customErrorState;
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  add(): void {
    this.submitted = true;
    const link: FcRuleEdge = this.ruleNodeLinkFormGroup.get('link').value;
    this.link = {...this.link, ...link};
    this.dialogRef.close(this.link);
  }
}

export interface AddRuleNodeDialogData {
  ruleNode: FcRuleNode;
  ruleChainId: string;
}

@Component({
  selector: 'tb-add-rule-node-dialog',
  templateUrl: './add-rule-node-dialog.component.html',
  providers: [{provide: ErrorStateMatcher, useExisting: AddRuleNodeDialogComponent}],
  styleUrls: []
})
export class AddRuleNodeDialogComponent extends DialogComponent<AddRuleNodeDialogComponent, FcRuleNode>
  implements OnInit, ErrorStateMatcher {

  @ViewChild('tbRuleNode', {static: true}) ruleNodeDetailsComponent: RuleNodeDetailsComponent;

  ruleNode: FcRuleNode;
  ruleChainId: string;

  submitted = false;

  constructor(protected store: Store<AppState>,
              protected router: Router,
              @Inject(MAT_DIALOG_DATA) public data: AddRuleNodeDialogData,
              @SkipSelf() private errorStateMatcher: ErrorStateMatcher,
              public dialogRef: MatDialogRef<AddRuleNodeDialogComponent, FcRuleNode>) {
    super(store, router, dialogRef);

    this.ruleNode = this.data.ruleNode;
    this.ruleChainId = this.data.ruleChainId;
  }

  ngOnInit(): void {
  }

  isErrorState(control: FormControl | null, form: FormGroupDirective | NgForm | null): boolean {
    const originalErrorState = this.errorStateMatcher.isErrorState(control, form);
    const customErrorState = !!(control && control.invalid && this.submitted);
    return originalErrorState || customErrorState;
  }

  helpLinkIdForRuleNodeType(): string {
    return getRuleNodeHelpLink(this.ruleNode.component);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  add(): void {
    this.submitted = true;
    this.ruleNodeDetailsComponent.validate();
    if (this.ruleNodeDetailsComponent.ruleNodeFormGroup.valid) {
      this.dialogRef.close(this.ruleNode);
    }
  }
}
