import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export const socket = io(URL, { autoConnect: false });

const PARTICIPANT_ID_KEY = 'playdate-participant-id';
let participantId;
let currentRoomId = null;
let hasOtherPlayer = false;

export function getParticipantId() {
  if (participantId) {
    return participantId;
  }

  participantId = sessionStorage.getItem(PARTICIPANT_ID_KEY);
  if (!participantId) {
    participantId = crypto.randomUUID();
    sessionStorage.setItem(PARTICIPANT_ID_KEY, participantId);
  }

  return participantId;
}

export function setCurrentRoom(roomId, opponentPresent = false) {
  currentRoomId = roomId;
  hasOtherPlayer = opponentPresent;
}

export function clearCurrentRoom(roomId) {
  if (roomId === undefined || currentRoomId === roomId) {
    currentRoomId = null;
    hasOtherPlayer = false;
  }
}

export function getCurrentRoomState(roomId) {
  return {
    isInRoom: currentRoomId === roomId,
    hasOtherPlayer: currentRoomId === roomId && hasOtherPlayer,
  };
}

export function setOtherPlayerPresent(present) {
  hasOtherPlayer = present;
}
