import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Droplets,
  Eraser,
  Highlighter,
  LockKeyhole,
  PaintBucket,
  PaintbrushVertical,
  PenLine,
  Pencil,
  PencilLine,
  RotateCcw,
  UnlockKeyhole,
} from 'lucide-react';
import { getCurrentRoomState, getParticipantId, socket } from '../../socket.js';

const TOOLS = [
  { id: 'marker', label: 'Marker', Icon: PaintbrushVertical },
  { id: 'pen', label: 'Pen', Icon: PenLine },
  { id: 'watercolor', label: 'Watercolor', Icon: Droplets },
  { id: 'pencil', label: 'Pencil', Icon: Pencil },
  { id: 'crayon', label: 'Crayon', Icon: PencilLine },
  { id: 'highlighter', label: 'Highlighter', Icon: Highlighter },
  { id: 'fill', label: 'Fill', Icon: PaintBucket },
  { id: 'eraser', label: 'Eraser', Icon: Eraser },
];

const crayonTiles = new Map();

function seededNoise(seed) {
  let value = seed | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4294967296;
}

function getCrayonTexture(context, color) {
  if (!crayonTiles.has(color)) {
    const tile = document.createElement('canvas');
    tile.width = 48;
    tile.height = 48;
    const textureContext = tile.getContext('2d');

    if (!textureContext) {
      return color;
    }

    for (let y = 0; y < tile.height; y += 2) {
      for (let x = 0; x < tile.width; x += 2) {
        const noise = seededNoise(x * 374761393 + y * 668265263);
        if (noise < 0.3) {
          continue;
        }
        textureContext.fillStyle = `${color}${Math.round(45 + noise * 150)
          .toString(16)
          .padStart(2, '0')}`;
        textureContext.fillRect(x, y, noise > 0.78 ? 2 : 1, noise > 0.78 ? 2 : 1);
      }
    }

    if (crayonTiles.size >= 24) {
      crayonTiles.delete(crayonTiles.keys().next().value);
    }
    crayonTiles.set(color, tile);
  }

  return context.createPattern(crayonTiles.get(color), 'repeat') || color;
}

function drawPencilGrain(context, from, point, action, width) {
  const dx = point.x - from.x;
  const dy = point.y - from.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / 2));
  let seed = (Math.floor(action.x * 1000003) ^ Math.floor(action.y * 9176)) || 1;
  const normalX = distance ? -dy / distance : 0;
  const normalY = distance ? dx / distance : 0;

  context.save();
  context.fillStyle = action.color;
  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    const x = from.x + dx * progress;
    const y = from.y + dy * progress;
    for (let grain = 0; grain < 4; grain += 1) {
      const offset = index * 4 + grain;
      const across = (seededNoise(seed + offset * 2) - 0.5) * width;
      const along = (seededNoise(seed + offset * 2 + 1) - 0.5) * 2;
      context.globalAlpha = 0.08 + seededNoise(seed + offset * 3 + 2) * 0.2;
      context.beginPath();
      context.arc(
        x + normalX * across + (distance ? (dx / distance) * along : across),
        y + normalY * across + (distance ? (dy / distance) * along : 0),
        0.35 + seededNoise(seed + offset * 5 + 4) * 0.75,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    seed = (seed * 1664525 + 1013904223) | 0;
  }
  context.restore();
}

function paintHighlighterPath(context, action, width, height) {
  const points = action.points.map((point) => ({
    x: point.x * width,
    y: point.y * height,
  }));
  if (points.length < 2) {
    return;
  }

  context.save();
  context.globalAlpha = 0.32;
  context.globalCompositeOperation = 'source-over';
  context.strokeStyle = action.color;
  context.lineWidth = Math.max(1, action.lineWidth * Math.min(width, height) * 2.4);
  context.lineCap = 'butt';
  context.lineJoin = 'bevel';
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();
  context.restore();
}

function paintClosedFill(context, action, width, height) {
  const points = action.points.map((point) => ({
    x: point.x * width,
    y: point.y * height,
  }));
  if (points.length < 3) {
    return;
  }

  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = action.color;
  context.strokeStyle = action.color;
  context.lineWidth = Math.max(1, action.lineWidth * Math.min(width, height));
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash([context.lineWidth * 1.8, context.lineWidth * 1.2]);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function paintAction(context, previousPoint, action, width, height) {
  if (!context || width === 0 || height === 0) {
    return action.type === 'end' ? null : previousPoint;
  }

  if (action.type === 'fill' && Array.isArray(action.points)) {
    paintClosedFill(context, action, width, height);
    return null;
  }
  if (action.type === 'stroke' && action.tool === 'highlighter' && Array.isArray(action.points)) {
    paintHighlighterPath(context, action, width, height);
    return null;
  }

  const point = { x: action.x * width, y: action.y * height };
  const from = action.type === 'start' ? point : previousPoint || point;

  context.save();
  context.globalCompositeOperation = action.tool === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = action.color;
  const baseWidth = Math.max(1, action.lineWidth * Math.min(width, height));
  context.lineWidth = action.tool === 'watercolor' ? baseWidth * 1.5 : baseWidth;
  context.globalAlpha =
    action.tool === 'watercolor' ? 0.13 : action.tool === 'pencil' ? 0.1 : 1;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (action.tool === 'crayon') {
    context.globalAlpha = 0.9;
    context.strokeStyle = getCrayonTexture(context, action.color);
    context.lineWidth = baseWidth * 1.2;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  } else if (action.tool === 'pencil') {
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    drawPencilGrain(context, from, point, action, baseWidth);
  } else {
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  if (action.tool === 'watercolor') {
    context.globalAlpha = 0.08;
    context.lineWidth = baseWidth * 2;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.restore();

  return action.type === 'end' ? null : point;
}

function Whiteboard({ roomId, hasOtherPlayer }) {
  const drawingAreaRef = useRef(null);
  const ownCanvasRef = useRef(null);
  const partnerCanvasRef = useRef(null);
  const ownPreviewCanvasRef = useRef(null);
  const partnerPreviewCanvasRef = useRef(null);
  const boardActionsRef = useRef([]);
  const fillPreviewsRef = useRef({ own: null, partner: null });
  const previousPointsRef = useRef({ own: null, partner: null });
  const drawingRef = useRef(null);
  const lastPointerRef = useRef(null);
  const protectMyStrokesRef = useRef(true);
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const [color, setColor] = useState('#9279f7');
  const [lineWidth, setLineWidth] = useState(5);
  const [activeTool, setActiveTool] = useState('pen');
  const [protectMyStrokes, setProtectMyStrokes] = useState(true);
  const [partnerProtectsStrokes, setPartnerProtectsStrokes] = useState(true);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [error, setError] = useState('');

  const renderPathPreview = useCallback((layer, action) => {
    const canvas = layer === 'own' ? ownPreviewCanvasRef.current : partnerPreviewCanvasRef.current;
    const context = canvas?.getContext('2d');
    const preview = fillPreviewsRef.current[layer];
    const { width, height } = dimensionsRef.current;
    if (!context || !canvas) {
      return;
    }

    if (action.type === 'start') {
      fillPreviewsRef.current[layer] = {
        points: [{ x: action.x, y: action.y }],
        color: action.color,
        lineWidth: action.lineWidth,
        tool: action.tool,
      };
    } else if (action.type === 'draw' && preview) {
      preview.points.push({ x: action.x, y: action.y });
    } else if (action.type === 'end') {
      fillPreviewsRef.current[layer] = null;
    }

    context.clearRect(0, 0, width, height);
    const current = fillPreviewsRef.current[layer];
    if (!current || current.points.length === 0) {
      return;
    }

    context.save();
    context.globalAlpha = current.tool === 'highlighter-preview' ? 0.32 : 0.9;
    context.strokeStyle = current.color;
    context.lineWidth = Math.max(
      1,
      current.lineWidth * Math.min(width, height) * (current.tool === 'highlighter-preview' ? 2.4 : 1),
    );
    context.lineCap = current.tool === 'highlighter-preview' ? 'butt' : 'round';
    context.lineJoin = current.tool === 'highlighter-preview' ? 'bevel' : 'round';
    context.setLineDash(current.tool === 'highlighter-preview' ? [] : [7, 5]);
    context.beginPath();
    context.moveTo(current.points[0].x * width, current.points[0].y * height);
    for (const point of current.points.slice(1)) {
      context.lineTo(point.x * width, point.y * height);
    }
    context.stroke();
    context.restore();
  }, []);

  const paintOnLayer = useCallback(
    (layer, action, origin) => {
      const canvas = layer === 'own' ? ownCanvasRef.current : partnerCanvasRef.current;
      const context = canvas?.getContext('2d');
      const { width, height } = dimensionsRef.current;

      previousPointsRef.current[layer] = paintAction(
        context,
        previousPointsRef.current[origin],
        action,
        width,
        height,
      );

      if (origin === layer) {
        previousPointsRef.current[origin] = previousPointsRef.current[layer];
      }
    },
    [],
  );

  const applyAction = useCallback(
    (action, origin, participantId, shouldRecord = true) => {
      if (shouldRecord) {
        boardActionsRef.current.push({ participantId, strokeData: action });
      }

      if (action.tool === 'fill') {
        renderPathPreview(origin, { type: 'end' });
        const canvas = origin === 'own' ? ownCanvasRef.current : partnerCanvasRef.current;
        paintAction(
          canvas?.getContext('2d'),
          null,
          action,
          dimensionsRef.current.width,
          dimensionsRef.current.height,
        );
        return;
      }
      if (action.type === 'stroke' && action.tool === 'highlighter') {
        renderPathPreview(origin, { type: 'end' });
        paintOnLayer(origin, action, origin);
        return;
      }

      paintOnLayer(origin, action, origin);
      if (action.tool === 'eraser' && action.eraseOtherStrokes) {
        paintOnLayer(origin === 'own' ? 'partner' : 'own', action, origin);
      }
    },
    [paintOnLayer, renderPathPreview],
  );

  const clearCanvases = useCallback(() => {
    boardActionsRef.current = [];
    previousPointsRef.current = { own: null, partner: null };

    for (const canvas of [ownCanvasRef.current, partnerCanvasRef.current]) {
      const context = canvas?.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
    }
    fillPreviewsRef.current = { own: null, partner: null };
    for (const canvas of [ownPreviewCanvasRef.current, partnerPreviewCanvasRef.current]) {
      const context = canvas?.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  useEffect(() => {
    const drawingArea = drawingAreaRef.current;
    if (!drawingArea) {
      return undefined;
    }

    function resizeCanvases() {
      const { width, height } = drawingArea.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      dimensionsRef.current = { width, height };

      for (const canvas of [
        ownCanvasRef.current,
        partnerCanvasRef.current,
        ownPreviewCanvasRef.current,
        partnerPreviewCanvasRef.current,
      ]) {
        if (!canvas) {
          continue;
        }

        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.getContext('2d')?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      }

      previousPointsRef.current = { own: null, partner: null };
      for (const { participantId, strokeData } of boardActionsRef.current) {
        const origin = participantId === getParticipantId() ? 'own' : 'partner';
        applyAction(strokeData, origin, participantId, false);
      }
      renderPathPreview('own', { type: 'redraw' });
      renderPathPreview('partner', { type: 'redraw' });
    }

    resizeCanvases();
    const observer = new ResizeObserver(resizeCanvases);
    observer.observe(drawingArea);
    window.addEventListener('resize', resizeCanvases);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeCanvases);
    };
  }, [applyAction, renderPathPreview]);

  useEffect(() => {
    function restoreBoardState(boardState) {
      if (boardState.roomId !== roomId || !Array.isArray(boardState.actions)) {
        return;
      }

      clearCanvases();
      setError('');
      const protectedStrokes = boardState.protectMyStrokes !== false;
      protectMyStrokesRef.current = protectedStrokes;
      setProtectMyStrokes(protectedStrokes);
      setPartnerProtectsStrokes(boardState.partnerProtectsStrokes !== false);
      boardActionsRef.current = boardState.actions.filter(
        (entry) =>
          entry &&
          typeof entry.participantId === 'string' &&
          entry.strokeData &&
          typeof entry.strokeData === 'object',
      );

      for (const { participantId, strokeData } of boardActionsRef.current) {
        const origin = participantId === getParticipantId() ? 'own' : 'partner';
        applyAction(strokeData, origin, participantId, false);
      }
    }

    function handleRemoteDraw(entry) {
      if (entry?.strokeData && typeof entry.participantId === 'string') {
        const origin = entry.participantId === getParticipantId() ? 'own' : 'partner';
        applyAction(entry.strokeData, origin, entry.participantId);
      }
    }

    function handleRemotePathPreview(entry) {
      if (
        ['fill-preview', 'highlighter-preview'].includes(entry?.strokeData?.tool) &&
        typeof entry.participantId === 'string'
      ) {
        const origin = entry.participantId === getParticipantId() ? 'own' : 'partner';
        renderPathPreview(origin, entry.strokeData);
      }
    }

    function handleClearBoard() {
      clearCanvases();
    }

    function handleRoomJoined(boardState) {
      const { roomId: joinedRoomId, partnerProtectsStrokes: partnerProtected } = boardState;
      if (joinedRoomId === roomId && typeof partnerProtected === 'boolean') {
        restoreBoardState(boardState);
      }
    }

    function handleBoardState(boardState) {
      restoreBoardState(boardState);
    }

    function handleRoomError({ message }) {
      setError(message);
    }

    function handleUserJoined({ roomId: joinedRoomId, protectMyStrokes: partnerProtected }) {
      if (joinedRoomId === roomId && typeof partnerProtected === 'boolean') {
        setPartnerProtectsStrokes(partnerProtected);
      }
    }

    function handleUserLeft() {
      setPartnerProtectsStrokes(true);
    }

    function handleProtectionChanged({
      roomId: updatedRoomId,
      participantId,
      protectMyStrokes: partnerProtected,
    }) {
      if (
        updatedRoomId === roomId &&
        participantId !== getParticipantId() &&
        typeof partnerProtected === 'boolean'
      ) {
        setPartnerProtectsStrokes(partnerProtected);
      }
    }

    function handleConnect() {
      setIsConnected(true);
    }

    function handleDisconnect() {
      setIsConnected(false);
      drawingRef.current = null;
      previousPointsRef.current = { own: null, partner: null };
      renderPathPreview('own', { type: 'end' });
      renderPathPreview('partner', { type: 'end' });
    }

    socket.on('remote_draw_event', handleRemoteDraw);
    socket.on('remote_path_preview', handleRemotePathPreview);
    socket.on('clear_board', handleClearBoard);
    socket.on('room_joined', handleRoomJoined);
    socket.on('board_state', handleBoardState);
    socket.on('user_joined', handleUserJoined);
    socket.on('user_left', handleUserLeft);
    socket.on('stroke_protection_changed', handleProtectionChanged);
    socket.on('room_error', handleRoomError);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    if (getCurrentRoomState(roomId).isInRoom) {
      socket.emit('request_board_state', { roomId });
    }

    return () => {
      socket.off('remote_draw_event', handleRemoteDraw);
      socket.off('remote_path_preview', handleRemotePathPreview);
      socket.off('clear_board', handleClearBoard);
      socket.off('room_joined', handleRoomJoined);
      socket.off('board_state', handleBoardState);
      socket.off('user_joined', handleUserJoined);
      socket.off('user_left', handleUserLeft);
      socket.off('stroke_protection_changed', handleProtectionChanged);
      socket.off('room_error', handleRoomError);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [applyAction, clearCanvases, renderPathPreview, roomId]);

  function getNormalizedPoint(event) {
    const bounds = drawingAreaRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  function createAction(event, type, tool = activeTool) {
    const point = getNormalizedPoint(event);
    const { width, height } = dimensionsRef.current;

    let effectiveWidth = lineWidth;
    if (tool === 'marker' && type !== 'start') {
      const previous = lastPointerRef.current;
      if (previous) {
        const elapsed = Math.max(1, event.timeStamp - previous.timeStamp);
        const speed = Math.hypot(event.clientX - previous.x, event.clientY - previous.y) / elapsed;
        effectiveWidth *= 0.1 + 0.9 / (1 + Math.pow(speed / 0.4, 1.4));
      }
    }

    lastPointerRef.current = { x: event.clientX, y: event.clientY, timeStamp: event.timeStamp };
    return {
      type,
      ...point,
      color,
      lineWidth: effectiveWidth / Math.max(1, Math.min(width, height)),
      tool,
      eraseOtherStrokes: tool === 'eraser' && !partnerProtectsStrokes,
    };
  }

  function emitAction(action) {
    socket.emit('draw_event', { roomId, strokeData: action });
  }

  function emitPathPreview(action) {
    socket.emit('path_preview', { roomId, strokeData: action });
  }

  function handlePointerDown(event) {
    if (!isConnected || event.button !== 0) {
      return;
    }

    event.preventDefault();
    if (activeTool === 'fill' || activeTool === 'highlighter') {
      event.currentTarget.setPointerCapture(event.pointerId);
      const previewTool = activeTool === 'fill' ? 'fill-preview' : 'highlighter-preview';
      const action = createAction(event, 'start', previewTool);
      drawingRef.current = {
        pointerId: event.pointerId,
        tool: activeTool,
        points: [{ x: action.x, y: action.y }],
        color,
        lineWidth: action.lineWidth,
      };
      setError('');
      renderPathPreview('own', action);
      emitPathPreview(action);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    lastPointerRef.current = null;
    const action = createAction(event, 'start');
    drawingRef.current = { pointerId: event.pointerId, tool: activeTool };
    applyAction(action, 'own', getParticipantId());
    emitAction(action);
  }

  function handlePointerMove(event) {
    if (!drawingRef.current || drawingRef.current.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const moveEvents = event.nativeEvent.getCoalescedEvents?.() || [event.nativeEvent];

    for (const moveEvent of moveEvents) {
      if (drawingRef.current.tool === 'fill' || drawingRef.current.tool === 'highlighter') {
        const previewTool =
          drawingRef.current.tool === 'fill' ? 'fill-preview' : 'highlighter-preview';
        const action = createAction(moveEvent, 'draw', previewTool);
        drawingRef.current.points.push({ x: action.x, y: action.y });
        renderPathPreview('own', action);
        emitPathPreview(action);
        continue;
      }

      const action = createAction(moveEvent, 'draw', drawingRef.current.tool);
      applyAction(action, 'own', getParticipantId());
      emitAction(action);
    }
  }

  function handlePointerEnd(event) {
    if (!drawingRef.current || drawingRef.current.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    if (drawingRef.current.tool === 'fill' || drawingRef.current.tool === 'highlighter') {
      const drawing = drawingRef.current;
      const previewTool = drawing.tool === 'fill' ? 'fill-preview' : 'highlighter-preview';
      if (event.type === 'pointercancel') {
        renderPathPreview('own', { type: 'end' });
        emitPathPreview(createAction(event, 'end', previewTool));
      } else {
        const endPoint = createAction(event, 'draw', previewTool);
        const points = drawing.points;
        const previous = points[points.length - 1];
        if (previous.x !== endPoint.x || previous.y !== endPoint.y) {
          points.push({ x: endPoint.x, y: endPoint.y });
        }

        const first = points[0];
        const last = points[points.length - 1];
        const { width, height } = dimensionsRef.current;
        const closureDistance = Math.hypot(
          (first.x - last.x) * width,
          (first.y - last.y) * height,
        );
        const area = Math.abs(
          points.reduce((sum, point, index) => {
            const next = points[(index + 1) % points.length];
            return sum + point.x * width * next.y * height - next.x * width * point.y * height;
          }, 0) / 2,
        );

        if (drawing.tool === 'highlighter' && points.length >= 2) {
          const action = {
            type: 'stroke',
            tool: 'highlighter',
            x: last.x,
            y: last.y,
            points: points.slice(),
            color: drawing.color,
            lineWidth: drawing.lineWidth,
          };
          applyAction(action, 'own', getParticipantId());
          emitAction(action);
        } else if (
          drawing.tool === 'fill' &&
          points.length >= 4 &&
          closureDistance <= Math.max(18, lineWidth * 2) &&
          area >= 16
        ) {
          const action = {
            type: 'fill',
            tool: 'fill',
            x: last.x,
            y: last.y,
            points: points.slice(),
            color: drawing.color,
            lineWidth: drawing.lineWidth,
          };
          applyAction(action, 'own', getParticipantId());
          emitAction(action);
        } else {
          renderPathPreview('own', { type: 'end' });
          emitPathPreview(createAction(event, 'end', previewTool));
          if (drawing.tool === 'fill') {
            setError('Close the dashed outline to fill its interior.');
          }
        }
      }
      drawingRef.current = null;
      lastPointerRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    const action = createAction(event, 'end', drawingRef.current.tool);
    applyAction(action, 'own', getParticipantId());
    emitAction(action);
    drawingRef.current = null;
    lastPointerRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleProtectionToggle(event) {
    const enabled = event.target.checked;
    protectMyStrokesRef.current = enabled;
    setProtectMyStrokes(enabled);
    socket.emit('set_stroke_protection', { roomId, protectMyStrokes: enabled });
  }

  function handleClearBoard() {
    clearCanvases();
    socket.emit('clear_board', { roomId });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex min-h-14 items-center justify-end border-b border-slate-100 bg-white px-4 py-2 sm:px-6">
        <button
          className="flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
          onClick={handleClearBoard}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={15} />
          <span>Clear board</span>
        </button>
      </div>

      <div
        aria-label="Shared whiteboard drawing area"
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-white"
        onContextMenu={(event) => event.preventDefault()}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        ref={drawingAreaRef}
        role="application"
        style={{
          cursor: activeTool === 'eraser' ? 'cell' : activeTool === 'fill' ? 'copy' : 'crosshair',
        }}
      >
        <canvas
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          ref={partnerCanvasRef}
          style={{ zIndex: protectMyStrokes ? 0 : 2 }}
        />
        <canvas
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          ref={ownCanvasRef}
          style={{ zIndex: protectMyStrokes ? 2 : 0 }}
        />
        <canvas
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          ref={partnerPreviewCanvasRef}
          style={{ zIndex: protectMyStrokes ? 1 : 3 }}
        />
        <canvas
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          ref={ownPreviewCanvasRef}
          style={{ zIndex: protectMyStrokes ? 3 : 1 }}
        />
        {!hasOtherPlayer && (
          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-slate-100 bg-white/95 px-4 py-2 text-xs font-medium text-slate-500 shadow-sm">
            Waiting for your partner to join…
          </div>
        )}
        {error && (
          <div
            className="absolute left-1/2 top-16 -translate-x-1/2 rounded-xl bg-red-50 px-4 py-2 text-center text-xs font-medium text-red-700 shadow-sm"
            role="alert"
          >
            {error}
          </div>
        )}
        {!isConnected && (
          <div
            className="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-ink/90 px-4 py-2 text-xs font-medium text-white"
            role="status"
          >
            Reconnecting — drawing is paused
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-100 px-2 py-2 sm:px-4">
        <div aria-label="Whiteboard tools" className="flex items-center gap-1 overflow-x-auto">
          {TOOLS.map(({ id, label, Icon }) => {
            const selected = activeTool === id;
            return (
              <button
                key={id}
                aria-label={label}
                aria-pressed={selected}
                className={`flex h-14 min-w-12 shrink-0 flex-col items-center justify-center rounded-xl px-2 transition ${
                  selected
                    ? 'bg-sky-100 text-sky-700 shadow-sm'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
                onClick={() => setActiveTool(id)}
                title={
                  id === 'fill'
                    ? 'Draw a closed dashed outline; release near the start to fill it'
                    : label
                }
                type="button"
              >
                <Icon aria-hidden="true" size={selected ? 25 : 19} strokeWidth={selected ? 2.4 : 1.8} />
                <span className="mt-0.5 whitespace-nowrap text-[10px] font-medium">{label}</span>
              </button>
            );
          })}

          <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 border-l border-slate-300 pl-3" title="Brush color">
            <span className="sr-only">Brush color</span>
            <input
              aria-label="Brush color"
              className="h-9 w-9 cursor-pointer rounded-lg border-0 bg-transparent p-0"
              disabled={activeTool === 'eraser'}
              onChange={(event) => setColor(event.target.value)}
              type="color"
              value={color}
            />
          </label>
        </div>
        <label className="mx-auto mt-1 flex max-w-60 items-center justify-center gap-2 text-xs text-slate-500">
          <span>Size</span>
          <input
            aria-label="Brush size"
            className="h-1.5 w-32 cursor-pointer accent-sky-600"
            max="24"
            min="2"
            onChange={(event) => setLineWidth(Number(event.target.value))}
            type="range"
            value={lineWidth}
          />
          <span className="w-8 tabular-nums">{lineWidth}px</span>
        </label>
      </div>

      <div className="flex min-h-10 items-center justify-center gap-2 border-t border-slate-100 bg-white px-4 text-xs text-slate-500">
        {protectMyStrokes ? (
          <LockKeyhole aria-hidden="true" className="text-emerald-600" size={14} />
        ) : (
          <UnlockKeyhole aria-hidden="true" className="text-amber-600" size={14} />
        )}
        <label className="flex cursor-pointer items-center gap-2">
          <span>Protect my strokes from my partner</span>
          <input
            checked={protectMyStrokes}
            className="peer sr-only"
            onChange={handleProtectionToggle}
            type="checkbox"
          />
          <span
            aria-hidden="true"
            className={`relative h-5 w-9 rounded-full transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lilac ${
              protectMyStrokes
                ? 'bg-emerald-500 after:translate-x-4'
                : 'bg-slate-300 after:translate-x-0'
            }`}
          />
        </label>
        <span className="hidden text-slate-300 sm:inline">·</span>
        <span className="hidden sm:inline">
          {protectMyStrokes
            ? 'Your strokes stay on top and are safe from edits'
            : 'Your partner can paint over or erase your strokes'}
        </span>
      </div>
    </div>
  );
}

export default Whiteboard;
