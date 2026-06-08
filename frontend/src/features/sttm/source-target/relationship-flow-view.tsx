'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type ReactFlowProps,
} from '@xyflow/react';

import { getRelationshipViewportPadding } from './relationship-layout';

type RelationshipFlowViewProps = ReactFlowProps<any, any> & {
  /** Align viewport to top-left only on the first table selection. */
  alignOnGraphChange?: boolean;
};

function AlignGraphTopLeft({
  nodeSignature,
  enabled,
}: {
  nodeSignature: string;
  enabled: boolean;
}) {
  const { getNodes, setViewport } = useReactFlow();
  const padding = useMemo(() => getRelationshipViewportPadding(), []);
  const previousSignatureRef = useRef('');

  useEffect(() => {
    if (!enabled) return;

    if (!nodeSignature) {
      previousSignatureRef.current = '';
      return;
    }

    const isFirstPopulation = !previousSignatureRef.current;
    previousSignatureRef.current = nodeSignature;
    if (!isFirstPopulation) return;

    const frame = window.requestAnimationFrame(() => {
      const nodes = getNodes();
      if (!nodes.length) return;

      const minX = Math.min(...nodes.map((node) => node.position.x));
      const minY = Math.min(...nodes.map((node) => node.position.y));

      setViewport(
        {
          x: padding.left - minX,
          y: padding.top - minY,
          zoom: 1,
        },
        { duration: 220 },
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [enabled, getNodes, nodeSignature, padding.left, padding.top, setViewport]);

  return null;
}

function RelationshipFlowCanvas({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  onNodesChange,
  onEdgesChange,
  onConnect,
  alignOnGraphChange = true,
  proOptions,
  defaultEdgeOptions,
  style,
  children,
  ...rest
}: RelationshipFlowViewProps) {
  const nodeSignature = useMemo(
    () => (nodes ?? []).map((node) => node.id).sort().join('|'),
    [nodes],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      proOptions={proOptions ?? { hideAttribution: true }}
      defaultEdgeOptions={defaultEdgeOptions}
      defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      panOnScroll
      panOnDrag
      zoomOnScroll
      zoomOnPinch
      minZoom={0.25}
      maxZoom={1.75}
      style={style ?? { width: '100%', height: '100%' }}
      {...rest}
    >
      <AlignGraphTopLeft nodeSignature={nodeSignature} enabled={alignOnGraphChange} />
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#e2e8f0" />
      <Controls position="bottom-right" style={{ marginBottom: 16, marginRight: 16 }} />
      {(nodes?.length ?? 0) > 0 ? (
        <MiniMap
          pannable
          zoomable
          nodeColor="#cbd5e1"
          maskColor="rgba(248, 250, 252, 0.78)"
          position="bottom-left"
          style={{
            width: 128,
            height: 84,
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 16,
            marginLeft: 16,
          }}
        />
      ) : null}
      {children}
    </ReactFlow>
  );
}

export function RelationshipFlowView(props: RelationshipFlowViewProps) {
  return (
    <ReactFlowProvider>
      <RelationshipFlowCanvas {...props} />
    </ReactFlowProvider>
  );
}
