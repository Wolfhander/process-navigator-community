import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveCapabilities } from './capabilities';
import { loadOrganization, loadProcess } from './api';
import type { Edge, OrganizationMap, Point, ProcessModel, ProcessNode } from './types';

type ZoomCommand = { id: number; factor: number };
type FocusCommand = { id: number; elementId: string };
type ExpandedProcess = { process: ProcessModel; sourceProcessId: string; sourceProcessName: string; sourceElementId: string; sourceElementName: string };
type Props = {
  process: ProcessModel;
  selectedId?: string;
  onSelect: (node?: ProcessNode) => void;
  zoomCommand?: ZoomCommand;
  fitCommand?: number;
  focusCommand?: FocusCommand;
  personalMode?: boolean;
  personalLaneIds?: string[];
  stepStatuses?: Record<string, string>;
  availableStepIds?: string[];
};

const maxZoom = 4;
type Camera = { x: number; y: number; width: number; height: number };

function worldFor(process: ProcessModel): Camera {
  const nodeRight = process.nodes.reduce((maximum, node) => Math.max(maximum, node.x + node.width), 0);
  const nodeBottom = process.nodes.reduce((maximum, node) => Math.max(maximum, node.y + node.height), 0);
  const edgeRight = process.edges.flatMap(edge => edge.points).reduce((maximum, point) => Math.max(maximum, point.x), 0);
  const edgeBottom = process.edges.flatMap(edge => edge.points).reduce((maximum, point) => Math.max(maximum, point.y), 0);
  const laneBottom = process.lanes.reduce((maximum, lane) => Math.max(maximum, lane.y + lane.height), 0);

  return {
    x: 0,
    y: 0,
    width: Math.max(1660, nodeRight + 80, edgeRight + 80),
    height: Math.max(820, nodeBottom + 40, edgeBottom + 40, laneBottom)
  };
}

function embeddedWorldFor(process: ProcessModel): Camera {
  const nodeRight = process.nodes.reduce((maximum, node) => Math.max(maximum, node.x + node.width), 0);
  const nodeBottom = process.nodes.reduce((maximum, node) => Math.max(maximum, node.y + node.height), 0);
  const edgeRight = process.edges.flatMap(edge => edge.points).reduce((maximum, point) => Math.max(maximum, point.x), 0);
  const edgeBottom = process.edges.flatMap(edge => edge.points).reduce((maximum, point) => Math.max(maximum, point.y), 0);
  const laneBottom = process.lanes.reduce((maximum, lane) => Math.max(maximum, lane.y + lane.height), 0);
  return { x: 0, y: 0, width: Math.max(640, nodeRight + 55, edgeRight + 55), height: Math.max(240, nodeBottom + 30, edgeBottom + 30, laneBottom + 10) };
}

function pathFor(edge: Edge) {
  return edge.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
}

function labelPoint(edge: Edge) {
  for (let index = 0; index < edge.points.length - 1; index += 1) {
    const a = edge.points[index], b = edge.points[index + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) >= 30 && Math.abs(dx) >= Math.abs(dy)) {
      const offset = Math.sign(dx) * Math.min(52, Math.abs(dx) / 2);
      return { x: a.x + offset, y: a.y - 9 };
    }
  }
  const a = edge.points[0] ?? { x: 0, y: 0 }, b = edge.points[1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 9 };
}

function clampCamera(camera: Camera, world: Camera): Camera {
  const width = Math.min(world.width, Math.max(world.width / maxZoom, camera.width));
  const height = Math.min(world.height, Math.max(world.height / maxZoom, camera.height));
  return {
    width,
    height,
    x: Math.min(world.width - width, Math.max(world.x, camera.x)),
    y: Math.min(world.height - height, Math.max(world.y, camera.y))
  };
}

function zoomAt(camera: Camera, factor: number, anchor: Point, world: Camera): Camera {
  const width = camera.width / factor;
  const height = camera.height / factor;
  const ratioX = (anchor.x - camera.x) / camera.width;
  const ratioY = (anchor.y - camera.y) / camera.height;
  return clampCamera({
    width,
    height,
    x: anchor.x - width * ratioX,
    y: anchor.y - height * ratioY
  }, world);
}

const shortSystemName = (name: string) => name
  .replace(/^1С:ERP\. Управление холдингом$/i, '1С:УХ')
  .replace(/^1С:ERP Управление холдингом$/i, '1С:УХ')
  .replace(/^1С:PLM.*$/i, '1С:PLM')
  .replace(/^1С:ERP.*$/i, '1С:ERP');

function NodeShape({ node, selected, related, personal, muted, executionStatus, executionAvailable = false, showOverlays, onSelect, onToggleDetails }: { node: ProcessNode; selected: boolean; related: boolean; personal: boolean; muted: boolean; executionStatus?: string; executionAvailable?: boolean; showOverlays: boolean; onSelect: () => void; onToggleDetails: (processId: string, node: ProcessNode) => void }) {
  const capabilities = resolveCapabilities(node);
  const actionCount = capabilities.filter(capability => capability.kind === 'action').length;
  const artifactCount = capabilities.filter(capability => capability.kind === 'artifact').length;
  const systemNames = [...new Set(node.channels?.filter(channel => channel.kind === 'system').map(channel => channel.systemName).filter((name): name is string => !!name) ?? [])];
  const nonSystemChannels = node.channels?.filter(channel => channel.kind !== 'system').length ?? 0;
  const channelLabel = [...systemNames.slice(0, 2).map(shortSystemName), nonSystemChannels ? `+${nonSystemChannels} ${nonSystemChannels === 1 ? 'канал' : 'кан.'}` : ''].filter(Boolean).join(' · ');
  const overlayLabel = [channelLabel || (actionCount ? 'ERP' : ''), artifactCount ? `${artifactCount} мат.` : ''].filter(Boolean).join(' · ');
  const overlayWidth = Math.max(72, Math.min(node.width - 10, 24 + overlayLabel.length * 6));
  const common = {
    className: `node node--${node.type}${selected ? ' is-selected' : ''}${related ? ' is-related' : ''}${personal ? ' is-personal' : ''}${executionStatus ? ` execution-${executionStatus.toLowerCase()}` : ''}${executionAvailable ? ' execution-available' : ''}${muted ? ' is-muted' : ''}`,
    onClick: onSelect,
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    role: 'button',
    tabIndex: 0,
    onKeyDown: (event: React.KeyboardEvent) => (event.key === 'Enter' || event.key === ' ') && onSelect()
  };
  const cx = node.x + node.width / 2, cy = node.y + node.height / 2;
  if (node.type === 'startEvent' || node.type === 'endEvent') return <g {...common}><circle cx={cx} cy={cy} r={node.width / 2 - 3}/>{node.type === 'endEvent' && <circle cx={cx} cy={cy} r={node.width / 2 - 7}/>}<title>{node.name}</title></g>;
  if (node.type === 'exclusiveGateway') return <g {...common}><path d={`M ${cx} ${node.y} L ${node.x + node.width} ${cy} L ${cx} ${node.y + node.height} L ${node.x} ${cy} Z`}/><path className="gateway-mark" d={`M ${cx-9} ${cy-9} L ${cx+9} ${cy+9} M ${cx+9} ${cy-9} L ${cx-9} ${cy+9}`}/><title>{node.name}</title></g>;
  if (node.type === 'parallelGateway') return <g {...common}><path d={`M ${cx} ${node.y} L ${node.x + node.width} ${cy} L ${cx} ${node.y + node.height} L ${node.x} ${cy} Z`}/><path className="gateway-mark" d={`M ${cx} ${cy-11} V ${cy+11} M ${cx-11} ${cy} H ${cx+11}`}/><title>{node.name}</title></g>;
  const labelDensity = node.name.length > 105 ? ' is-dense' : node.name.length > 65 ? ' is-compact' : '';
  return <g {...common}><rect x={node.x} y={node.y} width={node.width} height={node.height} rx="12"/><foreignObject x={node.x + 10} y={node.y + 8} width={node.width - 20} height={node.height - 16}><div className={`node-label${labelDensity}`} title={node.name}>{node.name}</div></foreignObject>{showOverlays && overlayLabel && <g className="capability-overlay" transform={`translate(${node.x + node.width - 5} ${node.y - 5})`}><rect x={-overlayWidth} y={-18} width={overlayWidth} height={22} rx={11}/><text x={-overlayWidth / 2} y={-4} textAnchor="middle">{overlayLabel}</text></g>}{node.linkedProcessId && <g className="inline-expand-control" transform={`translate(${node.x + node.width + 8} ${node.y + node.height / 2})`} onClick={event => { event.stopPropagation(); onToggleDetails(node.linkedProcessId!, node); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onToggleDetails(node.linkedProcessId!, node); } }} role="button" tabIndex={0} aria-label={`Развернуть детализацию «${node.name}»`}><circle r="13"/><path d="M -5 0 H 5 M 0 -5 V 5"/></g>}</g>;
}

function InlineProcessLevel({ entry, level, onToggle, onCollapse, onOpen }: { entry: ExpandedProcess; level: number; onToggle: (processId: string, level: number, source: ProcessNode, sourceProcess: ProcessModel) => void; onCollapse: (level: number) => void; onOpen: (processId: string) => void }) {
  const { process } = entry;
  const world = embeddedWorldFor(process);
  const markerId = `inline-arrow-${process.id.replace(/[^a-zA-Z0-9_-]/g, '')}-${level}`;
  const diagramHeight = Math.max(250, Math.min(520, world.height / world.width * 1180));
  return <section className="inline-process-level" style={{ '--inline-level': level } as React.CSSProperties}>
    <header><span>Уровень {process.passport?.level ?? level + 1}</span><strong>{process.name}</strong><small>Раскрыт из «{entry.sourceElementName}»</small><button className="inline-process-open" onClick={() => onOpen(process.id)}>Открыть целиком</button><button onClick={() => onCollapse(level)} aria-label="Свернуть уровень">×</button></header>
    <div className="inline-process-diagram" style={{ height: diagramHeight }}>
      <svg viewBox={`${world.x} ${world.y} ${world.width} ${world.height}`} preserveAspectRatio="xMidYMid meet" aria-label={`Схема «${process.name}»`}>
        <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#47524b"/></marker></defs>
        <rect width={world.width} height={world.height} className="inline-diagram-background"/>
        <g className="inline-diagram-lanes">{process.lanes.map(lane => <g key={lane.id}><rect x="18" y={lane.y} width={world.width - 36} height={lane.height}/><foreignObject x="18" y={lane.y} width="48" height={lane.height}><div>{lane.name}</div></foreignObject></g>)}</g>
        <g className="inline-diagram-edges">{process.edges.map(edge => { const label = labelPoint(edge); return <g key={edge.id}><path d={pathFor(edge)} markerEnd={`url(#${markerId})`}/>{edge.label && <text x={label.x} y={label.y} textAnchor="middle">{edge.label}</text>}</g>; })}</g>
        <g className="inline-diagram-nodes">{process.nodes.map(node => <NodeShape key={node.id} node={node} selected={false} related={false} personal={false} muted={false} showOverlays executionStatus={undefined} onSelect={() => undefined} onToggleDetails={(id, source) => onToggle(id, level + 1, source, process)}/>)}</g>
      </svg>
    </div>
  </section>;
}

export function ProcessCanvas({ process, selectedId, onSelect, zoomCommand, fitCommand, focusCommand, personalMode = false, personalLaneIds = [], stepStatuses = {}, availableStepIds = [] }: Props) {
  const world = useMemo(() => worldFor(process), [process]);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; camera: Camera; moved: boolean } | undefined>(undefined);
  const suppressClickRef = useRef(false);
  const [camera, setCamera] = useState<Camera>(() => worldFor(process));
  const [organization, setOrganization] = useState<OrganizationMap>();
  const [expandedProcesses, setExpandedProcesses] = useState<ExpandedProcess[]>([]);
  const [expandError, setExpandError] = useState('');
  const zoom = world.width / camera.width;
  const selectedNode = process.nodes.find(node => node.id === selectedId);
  const activeLane = process.lanes.find(lane => lane.id === selectedNode?.laneId)
    ?? process.lanes.find(lane => camera.y + camera.height / 2 >= lane.y && camera.y + camera.height / 2 < lane.y + lane.height);
  const focusedEdges = new Set(process.edges.filter(edge => edge.sourceId === selectedId || edge.targetId === selectedId).map(edge => edge.id));
  const relatedNodes = new Set<string>([selectedId ?? '']);
  const personalLanes = new Set(personalLaneIds);
  const availableSteps = new Set(availableStepIds);
  const personalNodes = new Set(process.nodes.filter(node => personalLanes.has(node.laneId)).map(node => node.id));
  const crossCompanyProcess = organization?.crossCompanyProcesses.find(item => item.processId === process.id);
  const laneOrganization = (laneId: string) => {
    const mapping = crossCompanyProcess?.laneOrganizations.find(item => item.laneId === laneId);
    const entity = organization?.legalEntities.find(item => item.id === mapping?.legalEntityId);
    const unit = entity?.units?.find(item => item.id === mapping?.unitId);
    const laneName = mapping?.displayNameMode === 'full' ? unit?.name : unit?.shortName || unit?.name;
    return mapping && entity ? { entityName: entity.name, department: unit?.name ?? mapping.department, laneName: laneName ?? mapping.department } : undefined;
  };
  process.edges.forEach(edge => {
    if (focusedEdges.has(edge.id)) {
      relatedNodes.add(edge.sourceId);
      relatedNodes.add(edge.targetId);
    }
  });

  useEffect(() => { setCamera(world); }, [world]);
  useEffect(() => { setExpandedProcesses([]); setExpandError(''); }, [process.id]);
  useEffect(() => { if (zoomCommand) setCamera(current => zoomAt(current, zoomCommand.factor, { x: current.x + current.width / 2, y: current.y + current.height / 2 }, world)); }, [zoomCommand, world]);
  useEffect(() => { if (fitCommand !== undefined) setCamera(world); }, [fitCommand, world]);
  useEffect(() => {
    if (!focusCommand) return;
    const node = process.nodes.find(item => item.id === focusCommand.elementId);
    const lane = process.lanes.find(item => item.id === focusCommand.elementId);
    const laneNode = lane && process.nodes.find(item => item.laneId === lane.id);
    const edge = process.edges.find(item => item.id === focusCommand.elementId);
    const point = node ?? laneNode;
    const centerX = point ? point.x + point.width / 2 : edge?.points.length ? edge.points[Math.floor(edge.points.length / 2)].x : lane ? 200 : undefined;
    const centerY = point ? point.y + point.height / 2 : edge?.points.length ? edge.points[Math.floor(edge.points.length / 2)].y : lane ? lane.y + lane.height / 2 : undefined;
    if (centerX === undefined || centerY === undefined) return;
    const width = Math.min(world.width, 760);
    const height = Math.min(world.height, 480);
    setCamera(clampCamera({ x: centerX - width / 2, y: centerY - height / 2, width, height }, world));
  }, [focusCommand, process.nodes, process.lanes, process.edges, world]);
  useEffect(() => { const controller = new AbortController(); loadOrganization(controller.signal).then(setOrganization).catch(() => undefined); return () => controller.abort(); }, [process.id]);

  const pointFromClient = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: camera.x + (clientX - rect.left) / rect.width * camera.width, y: camera.y + (clientY - rect.top) / rect.height * camera.height };
  };

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
    setCamera(current => zoomAt(current, factor, pointFromClient(event.clientX, event.clientY), world));
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera, moved: false };
    event.currentTarget.classList.add('is-panning');
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 3) drag.moved = true;
    const rect = event.currentTarget.getBoundingClientRect();
    setCamera(clampCamera({ ...drag.camera, x: drag.camera.x - (event.clientX - drag.x) / rect.width * drag.camera.width, y: drag.camera.y - (event.clientY - drag.y) / rect.height * drag.camera.height }, world));
  };

  const stopPan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      suppressClickRef.current = dragRef.current.moved;
      dragRef.current = undefined;
    }
    event.currentTarget.classList.remove('is-panning');
  };

  const centerFromMinimap = (event: React.MouseEvent<SVGSVGElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * world.width;
    const y = (event.clientY - rect.top) / rect.height * world.height;
    setCamera(current => clampCamera({ ...current, x: x - current.width / 2, y: y - current.height / 2 }, world));
  };

  const toggleDetails = async (processId: string, level: number, source: ProcessNode, sourceProcess: ProcessModel) => {
    const existing = expandedProcesses[level];
    if (existing?.process.id === processId && existing.sourceElementId === source.id) {
      setExpandedProcesses(current => current.slice(0, Math.max(0, level)));
      return;
    }
    const ancestors = [process.id, ...expandedProcesses.slice(0, level).map(item => item.process.id)];
    if (ancestors.some(id => id === processId)) {
      setExpandError('Нельзя раскрыть процесс: обнаружена циклическая детализация.');
      return;
    }
    setExpandError('');
    try {
      const child = await loadProcess(processId);
      setExpandedProcesses(current => [...current.slice(0, level), { process: child, sourceProcessId: sourceProcess.id, sourceProcessName: sourceProcess.name, sourceElementId: source.id, sourceElementName: source.name }]);
    } catch (reason) {
      setExpandError(reason instanceof Error ? reason.message : 'Не удалось раскрыть связанную схему.');
    }
  };

  return <div className="canvas-wrap">
    <svg ref={svgRef} className="canvas" viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`} preserveAspectRatio="none" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={stopPan} onPointerCancel={stopPan} onDoubleClick={() => setCamera(world)} onClick={() => { if (suppressClickRef.current) suppressClickRef.current = false; else onSelect(); }} aria-label="Диаграмма процесса">
      <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dfe2dc" strokeWidth="1"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#47524b"/></marker><marker id="arrow-focus" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#d4673c"/></marker></defs>
      <rect width={world.width} height={world.height} fill="url(#grid)"/>
      <g className="lanes">{process.lanes.map(lane => { const affiliation = laneOrganization(lane.id); return <g key={lane.id} className={personalMode ? personalLanes.has(lane.id) ? 'is-personal' : 'is-muted' : ''}><rect className="lane" x="45" y={lane.y} width={world.width - 90} height={lane.height}/><foreignObject x="45" y={lane.y} width="55" height={lane.height}><div className="lane-title">{affiliation?.laneName ?? lane.name}</div></foreignObject>{affiliation && <foreignObject x={world.width - 345} y={lane.y + 10} width="285" height="34"><div className="lane-organization"><strong>{affiliation.entityName}</strong><span>{affiliation.department}</span></div></foreignObject>}</g>; })}</g>
      <g className="edges">{process.edges.map(edge => { const label = labelPoint(edge); const focused = !!selectedId && focusedEdges.has(edge.id); const personal = personalMode && (personalNodes.has(edge.sourceId) || personalNodes.has(edge.targetId)); const muted = selectedId ? !focused : personalMode && !personal; return <g key={edge.id} className={`${focused ? 'is-focused' : personal ? 'is-personal' : ''}${muted ? ' is-muted' : ''}`}><path d={pathFor(edge)} markerEnd={focused || personal ? 'url(#arrow-focus)' : 'url(#arrow)'}/><text x={label.x} y={label.y} textAnchor="middle">{edge.label}</text></g>; })}</g>
      <g className="nodes" onClick={event => event.stopPropagation()}>{process.nodes.map(node => <NodeShape key={node.id} node={node} selected={node.id === selectedId} related={!!selectedId && relatedNodes.has(node.id) && node.id !== selectedId} personal={personalMode && personalNodes.has(node.id)} muted={selectedId ? !relatedNodes.has(node.id) : personalMode && !personalNodes.has(node.id)} executionStatus={stepStatuses[node.id]} executionAvailable={availableSteps.has(node.id)} showOverlays={zoom >= 1.25 || node.id === selectedId} onSelect={() => onSelect(node)} onToggleDetails={(id, source) => toggleDetails(id, 0, source, process)}/>)}</g>
    </svg>
    <div className="zoom-readout">{Math.round(zoom * 100)}%</div>
    {activeLane && (zoom >= 1.2 || selectedNode) && <div className="lane-badge"><span>{selectedNode ? 'Ответственная дорожка' : 'Текущая дорожка'}</span><strong>{laneOrganization(activeLane.id)?.laneName ?? activeLane.name}</strong>{laneOrganization(activeLane.id) && <em>{laneOrganization(activeLane.id)?.entityName}</em>}</div>}
    <svg className="minimap" viewBox={`0 0 ${world.width} ${world.height}`} onClick={centerFromMinimap} aria-label="Мини-карта процесса">
      <rect className="minimap-bg" width={world.width} height={world.height}/>
      {process.lanes.map(lane => <rect key={lane.id} className="minimap-lane" x="45" y={lane.y} width={world.width - 90} height={lane.height}/>)}
      {process.edges.map(edge => <path key={edge.id} className="minimap-edge" d={pathFor(edge)}/>)}
      {process.nodes.map(node => <rect key={node.id} className={`minimap-node${node.id === selectedId ? ' is-selected' : ''}`} x={node.x} y={node.y} width={Math.max(node.width, 35)} height={Math.max(node.height, 35)}/>)}
      <rect className="minimap-viewport" x={camera.x} y={camera.y} width={camera.width} height={camera.height}/>
    </svg>
    <div className="canvas-hint">Колесо — масштаб · перетаскивание — обзор · двойной щелчок — весь процесс</div>
    {(expandedProcesses.length > 0 || expandError) && <div className="inline-process-explorer">
      <div className="inline-process-explorer-heading"><span>Развёрнутая детализация</span><small>Уровни раскрываются здесь без ухода с исходной схемы</small></div>
      {expandError && <p className="inline-process-error">{expandError}</p>}
      {expandedProcesses.map((entry, index) => <InlineProcessLevel key={`${index}:${entry.process.id}:${entry.sourceElementId}`} entry={entry} level={index} onToggle={toggleDetails} onCollapse={level => setExpandedProcesses(current => current.slice(0, level))} onOpen={id => window.dispatchEvent(new CustomEvent('pn:open-linked-process', { detail: id }))}/>) }
    </div>}
  </div>;
}
