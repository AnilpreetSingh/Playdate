const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');

dotenv.config({ path: path.join(__dirname, '.env') });

const ROOM_CODE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ROOM_CODE_LENGTH = 4;
const FRONTEND_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'];
const DRAW_ACTION_TYPES = new Set(['start', 'draw', 'end', 'fill', 'stroke']);
const DRAW_TOOLS = new Set([
  'marker',
  'pen',
  'watercolor',
  'pencil',
  'crayon',
  'highlighter',
  'fill',
  'eraser',
]);
const MAX_STROKE_POINTS = 4096;

function isValidPath(points, minimumPoints) {
  return (
    Array.isArray(points) &&
    points.length >= minimumPoints &&
    points.length <= MAX_STROKE_POINTS &&
    points.every(
      (point) =>
        point &&
        Number.isFinite(point.x) &&
        point.x >= 0 &&
        point.x <= 1 &&
        Number.isFinite(point.y) &&
        point.y >= 0 &&
        point.y <= 1,
    )
  );
}

function generateRoomCode() {
  return Array.from({ length: ROOM_CODE_LENGTH }, () => {
    const index = crypto.randomInt(ROOM_CODE_CHARACTERS.length);
    return ROOM_CODE_CHARACTERS[index];
  }).join('');
}

function createApp() {
  const app = express();
  app.use(cors({ origin: FRONTEND_ORIGINS, methods: ['GET', 'POST'] }));
  app.get('/health', (_request, response) => response.json({ status: 'ok' }));

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: FRONTEND_ORIGINS,
      methods: ['GET', 'POST'],
    },
  });
  const roomSessions = new Map();

  function getParticipantId(payload, socket) {
    return payload &&
      typeof payload === 'object' &&
      typeof payload.participantId === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(payload.participantId)
      ? payload.participantId
      : socket.id;
  }

  function getBoardState(roomId, participantId) {
    const roomSession = roomSessions.get(roomId);
    const otherParticipant = [...roomSession.participantIds]
      .reverse()
      .find((id) => id !== participantId);

    return {
      roomId,
      actions: roomSession.actions,
      protectMyStrokes: roomSession.protections.get(participantId) !== false,
      partnerProtectsStrokes: otherParticipant
        ? roomSession.protections.get(otherParticipant) !== false
        : true,
      hasOtherPlayer: (io.sockets.adapter.rooms.get(roomId)?.size || 0) > 1,
    };
  }

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('create_room', (payload) => {
      let roomId = generateRoomCode();

      while (roomSessions.has(roomId)) {
        roomId = generateRoomCode();
      }

      const participantId = getParticipantId(payload, socket);
      const roomSession = {
        actions: [],
        participantIds: new Set([participantId]),
        protections: new Map([[participantId, true]]),
      };
      roomSessions.set(roomId, roomSession);
      socket.data.participantId = participantId;
      socket.join(roomId);
      socket.data.protectMyStrokes = true;
      socket.emit('room_created', { roomId });
    });

    socket.on('join_room', (payload) => {
      const roomId = payload && typeof payload === 'object' ? payload.roomId : undefined;
      const roomSession = typeof roomId === 'string' ? roomSessions.get(roomId) : undefined;

      if (typeof roomId !== 'string' || !/^[A-Z0-9]{4}$/.test(roomId)) {
        socket.emit('room_error', { message: 'Invalid room code' });
        return;
      }

      const room = io.sockets.adapter.rooms.get(roomId);

      if (!roomSession) {
        socket.emit('room_error', { message: 'Room not found' });
        return;
      }

      if (!room?.has(socket.id) && room && room.size >= 2) {
        socket.emit('room_error', { message: 'Room is full' });
        return;
      }

      const participantId = getParticipantId(payload, socket);
      const partner = [...(room || [])]
        .filter((socketId) => socketId !== socket.id)
        .map((socketId) => io.sockets.sockets.get(socketId))
        .find(Boolean);
      if (!roomSession.participantIds.has(participantId)) {
        roomSession.participantIds.add(participantId);
        roomSession.protections.set(participantId, true);
      }
      socket.data.participantId = participantId;
      socket.data.protectMyStrokes = roomSession.protections.get(participantId) !== false;
      socket.join(roomId);
      socket.emit('room_joined', {
        roomId,
        ...getBoardState(roomId, participantId),
      });
      socket.to(roomId).emit('user_joined', {
        roomId,
        socketId: socket.id,
        participantId,
        protectMyStrokes: socket.data.protectMyStrokes,
      });
    });

    socket.on('request_board_state', (payload) => {
      const roomId = payload && typeof payload === 'object' ? payload.roomId : undefined;

      if (typeof roomId === 'string' && socket.rooms.has(roomId) && socket.data.participantId) {
        socket.emit('board_state', getBoardState(roomId, socket.data.participantId));
      }
    });

    socket.on('set_stroke_protection', (payload) => {
      const roomId = payload && typeof payload === 'object' ? payload.roomId : undefined;
      const protectMyStrokes =
        payload && typeof payload === 'object' ? payload.protectMyStrokes : undefined;

      if (
        typeof roomId === 'string' &&
        socket.rooms.has(roomId) &&
        typeof protectMyStrokes === 'boolean'
      ) {
        socket.data.protectMyStrokes = protectMyStrokes;
        roomSessions.get(roomId).protections.set(socket.data.participantId, protectMyStrokes);
        socket.to(roomId).emit('stroke_protection_changed', {
          roomId,
          socketId: socket.id,
          participantId: socket.data.participantId,
          protectMyStrokes,
        });
      }
    });

    socket.on('draw_event', (payload) => {
      const roomId = payload && typeof payload === 'object' ? payload.roomId : undefined;
      const strokeData = payload && typeof payload === 'object' ? payload.strokeData : undefined;
      const validFillPath = strokeData?.tool === 'fill' && isValidPath(strokeData.points, 3);
      const validHighlighterPath =
        strokeData?.tool === 'highlighter' && isValidPath(strokeData.points, 2);

      if (
        typeof roomId !== 'string' ||
        !socket.rooms.has(roomId) ||
        !strokeData ||
        typeof strokeData !== 'object' ||
        !DRAW_ACTION_TYPES.has(strokeData.type) ||
        !DRAW_TOOLS.has(strokeData.tool) ||
        (strokeData.tool === 'fill') !== (strokeData.type === 'fill') ||
        (strokeData.type === 'fill' && !validFillPath) ||
        (strokeData.type === 'stroke' && !validHighlighterPath) ||
        (strokeData.type !== 'stroke' && strokeData.tool === 'highlighter' && strokeData.points) ||
        !Number.isFinite(strokeData.x) ||
        strokeData.x < 0 ||
        strokeData.x > 1 ||
        !Number.isFinite(strokeData.y) ||
        strokeData.y < 0 ||
        strokeData.y > 1 ||
        !/^#[0-9a-fA-F]{6}$/.test(strokeData.color) ||
        !Number.isFinite(strokeData.lineWidth) ||
        strokeData.lineWidth <= 0 ||
        strokeData.lineWidth > 1
      ) {
        return;
      }

      const roomSession = roomSessions.get(roomId);
      const otherParticipant = [...roomSession.participantIds]
        .reverse()
        .find((id) => id !== socket.data.participantId);
      const recordedStroke = {
        ...strokeData,
        eraseOtherStrokes:
          strokeData.tool === 'eraser' &&
          otherParticipant !== undefined &&
          roomSession.protections.get(otherParticipant) === false,
      };
      const recordedAction = {
        participantId: socket.data.participantId,
        strokeData: recordedStroke,
      };

      roomSession.actions.push(recordedAction);
      socket.to(roomId).emit('remote_draw_event', recordedAction);
    });

    socket.on('path_preview', (payload) => {
      const roomId = payload && typeof payload === 'object' ? payload.roomId : undefined;
      const strokeData = payload && typeof payload === 'object' ? payload.strokeData : undefined;

      if (
        typeof roomId === 'string' &&
        socket.rooms.has(roomId) &&
        strokeData &&
        typeof strokeData === 'object' &&
        ['fill-preview', 'highlighter-preview'].includes(strokeData.tool) &&
        ['start', 'draw', 'end'].includes(strokeData.type) &&
        Number.isFinite(strokeData.x) &&
        strokeData.x >= 0 &&
        strokeData.x <= 1 &&
        Number.isFinite(strokeData.y) &&
        strokeData.y >= 0 &&
        strokeData.y <= 1 &&
        /^#[0-9a-fA-F]{6}$/.test(strokeData.color) &&
        Number.isFinite(strokeData.lineWidth) &&
        strokeData.lineWidth > 0 &&
        strokeData.lineWidth <= 1
      ) {
        socket.to(roomId).emit('remote_path_preview', {
          participantId: socket.data.participantId,
          strokeData,
        });
      }
    });

    socket.on('clear_board', (payload) => {
      const roomId = payload && typeof payload === 'object' ? payload.roomId : undefined;

      if (typeof roomId === 'string' && socket.rooms.has(roomId)) {
        roomSessions.get(roomId).actions = [];
        socket.to(roomId).emit('clear_board');
      }
    });

    socket.on('leave_room', (payload) => {
      const roomId = payload && typeof payload === 'object' ? payload.roomId : undefined;

      if (typeof roomId === 'string' && socket.rooms.has(roomId)) {
        socket.to(roomId).emit('user_left', { roomId, socketId: socket.id });
        socket.leave(roomId);
      }
    });

    socket.on('disconnecting', () => {
      for (const roomId of socket.rooms) {
        if (roomId !== socket.id) {
          socket.to(roomId).emit('user_left', { roomId, socketId: socket.id });
        }
      }
    });
  });

  return { app, io, server };
}

if (require.main === module) {
  const { server } = createApp();
  const port = Number(process.env.PORT) || 3001;

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

module.exports = { createApp, generateRoomCode };
