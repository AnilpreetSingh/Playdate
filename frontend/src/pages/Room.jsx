import { useEffect, useState } from 'react';
import { ArrowLeft, Gamepad2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import Whiteboard from '../components/games/Whiteboard.jsx';
import {
  clearCurrentRoom,
  getParticipantId,
  getCurrentRoomState,
  setCurrentRoom,
  setOtherPlayerPresent,
  socket,
} from '../socket.js';

function Room() {
  const { roomId = '' } = useParams();
  const normalizedRoomId = roomId.toUpperCase();
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [hasOtherPlayer, setHasOtherPlayer] = useState(
    () => getCurrentRoomState(normalizedRoomId).hasOtherPlayer,
  );
  const [error, setError] = useState('');

  useEffect(() => {
    function joinRoomIfNeeded() {
      if (!socket.connected) {
        return;
      }

      setIsConnected(true);
      if (!getCurrentRoomState(normalizedRoomId).isInRoom) {
        setError('');
        socket.emit('join_room', {
          roomId: normalizedRoomId,
          participantId: getParticipantId(),
        });
      }
    }

    function handleRoomJoined({ roomId: joinedRoomId, hasOtherPlayer: otherPlayerPresent }) {
      if (joinedRoomId === normalizedRoomId) {
        setCurrentRoom(joinedRoomId, otherPlayerPresent);
        setHasOtherPlayer(otherPlayerPresent);
      }
    }

    function handleUserJoined({ roomId: joinedRoomId }) {
      if (joinedRoomId !== normalizedRoomId) {
        return;
      }

      setOtherPlayerPresent(true);
      setHasOtherPlayer(true);
    }

    function handleUserLeft({ roomId: leftRoomId }) {
      if (leftRoomId !== normalizedRoomId) {
        return;
      }

      setOtherPlayerPresent(false);
      setHasOtherPlayer(false);
    }

    function handleRoomError({ message }) {
      setError(message);
    }

    function handleConnect() {
      setIsConnected(true);
      joinRoomIfNeeded();
    }

    function handleDisconnect() {
      setIsConnected(false);
      clearCurrentRoom(normalizedRoomId);
      setHasOtherPlayer(false);
    }

    socket.on('room_joined', handleRoomJoined);
    socket.on('user_joined', handleUserJoined);
    socket.on('user_left', handleUserLeft);
    socket.on('room_error', handleRoomError);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    joinRoomIfNeeded();

    return () => {
      socket.off('room_joined', handleRoomJoined);
      socket.off('user_joined', handleUserJoined);
      socket.off('user_left', handleUserLeft);
      socket.off('room_error', handleRoomError);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [normalizedRoomId]);

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-warm-white text-ink">
      <header className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <Link
            aria-label="Back to home"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-ink"
            onClick={() => {
              socket.emit('leave_room', { roomId: normalizedRoomId });
              clearCurrentRoom(normalizedRoomId);
            }}
            to="/"
          >
            <ArrowLeft aria-hidden="true" size={19} />
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lilac-light text-lilac-dark">
            <Gamepad2 aria-hidden="true" size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              Your room
            </p>
            <p className="font-mono text-sm font-extrabold tracking-[0.15em]">
              {normalizedRoomId}
            </p>
          </div>
        </div>

        <div
          aria-label={isConnected ? 'Connected' : 'Disconnected'}
          className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500"
          role="status"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isConnected ? 'bg-emerald-500' : 'bg-red-500'
            }`}
          />
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      <Whiteboard hasOtherPlayer={hasOtherPlayer} roomId={normalizedRoomId} />
      {error && <p className="sr-only" role="alert">{error}</p>}
    </main>
  );
}

export default Room;
