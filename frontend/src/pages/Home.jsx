import { useEffect, useState } from 'react';
import { ArrowRight, Gamepad2, Heart, Sparkles, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getParticipantId, setCurrentRoom, socket } from '../socket.js';

function Home() {
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleRoomCreated = ({ roomId }) => {
      setCurrentRoom(roomId);
      setIsCreating(false);
      navigate(`/room/${roomId}`);
    };
    const handleRoomJoined = ({ roomId }) => {
      setCurrentRoom(roomId, true);
      navigate(`/room/${roomId}`);
    };
    const handleRoomError = ({ message }) => {
      setError(message);
      setIsCreating(false);
    };
    const handleConnectError = () => {
      setError('Could not connect to the game server. Please try again.');
      setIsCreating(false);
    };

    socket.on('room_created', handleRoomCreated);
    socket.on('room_joined', handleRoomJoined);
    socket.on('room_error', handleRoomError);
    socket.on('connect_error', handleConnectError);

    return () => {
      socket.off('room_created', handleRoomCreated);
      socket.off('room_joined', handleRoomJoined);
      socket.off('room_error', handleRoomError);
      socket.off('connect_error', handleConnectError);
    };
  }, [navigate]);

  function handleCreateRoom() {
    setError('');
    setIsCreating(true);
    socket.emit('create_room', { participantId: getParticipantId() });
  }

  function handleJoinRoom(event) {
    event.preventDefault();

    if (roomCode.length !== 4) {
      setError('Enter a 4-character room code.');
      return;
    }

    setError('');
    socket.emit('join_room', { roomId: roomCode, participantId: getParticipantId() });
  }

  return (
    <main className="flex min-h-screen items-center justify-center overflow-hidden bg-warm-white px-5 py-12 text-ink">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-28 -top-32 h-80 w-80 rounded-full bg-lilac-light/80 blur-3xl" />
        <div className="absolute -bottom-40 -right-28 h-96 w-96 rounded-full bg-rose-100/70 blur-3xl" />
        <div className="absolute right-[18%] top-[14%] h-3 w-3 rounded-full bg-amber-300" />
        <div className="absolute left-[13%] top-[28%] h-2 w-2 rounded-full bg-lilac/60" />
      </div>

      <section className="relative w-full max-w-md rounded-[2rem] border border-white/80 bg-white/90 p-7 shadow-card backdrop-blur sm:p-10">
        <div className="mb-9 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lilac-light text-lilac-dark">
            <Gamepad2 aria-hidden="true" size={23} strokeWidth={2.2} />
          </div>
          <span className="text-lg font-extrabold tracking-tight">PLAYDATE</span>
          <span className="ml-auto rounded-full bg-lilac-light px-3 py-1 text-xs font-bold text-lilac-dark">
            BETA
          </span>
        </div>

        <div className="mb-8">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-500">
            <Heart aria-hidden="true" size={13} fill="currentColor" />
            Good times are better together
          </div>
          <h1 className="text-4xl font-black leading-[1.08] tracking-tight sm:text-[2.75rem]">
            Your next
            <br />
            <span className="text-lilac">favorite game</span>
            <br />
            starts here.
          </h1>
          <p className="mt-4 max-w-xs text-sm leading-6 text-slate-500">
            Make a little room for a lot of fun. Invite a friend and let the games begin.
          </p>
        </div>

        <button
          className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-lilac px-5 py-4 font-bold text-white shadow-lg shadow-lilac/25 transition hover:-translate-y-0.5 hover:bg-lilac-dark disabled:cursor-wait disabled:opacity-70"
          disabled={isCreating}
          onClick={handleCreateRoom}
          type="button"
        >
          <Sparkles aria-hidden="true" size={19} />
          {isCreating ? 'Creating your room…' : 'Create a room'}
          <ArrowRight
            aria-hidden="true"
            className="ml-1 transition-transform group-hover:translate-x-1"
            size={18}
          />
        </button>

        <div className="my-7 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">
          <span className="h-px flex-1 bg-slate-100" />
          or join a friend
          <span className="h-px flex-1 bg-slate-100" />
        </div>

        <form onSubmit={handleJoinRoom}>
          <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="room-code">
            Room code
          </label>
          <div className="flex gap-2">
            <input
              autoComplete="off"
              className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 font-mono text-lg font-bold uppercase tracking-[0.25em] text-ink outline-none transition placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal focus:border-lilac focus:bg-white focus:ring-4 focus:ring-lilac/10"
              id="room-code"
              maxLength={4}
              onChange={(event) =>
                setRoomCode(event.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
              }
              placeholder="e.g. X7K9"
              value={roomCode}
            />
            <button
              aria-label="Join room"
              className="flex h-[3.375rem] w-[3.375rem] shrink-0 items-center justify-center rounded-2xl bg-ink text-white transition hover:bg-lilac-dark focus:outline-none focus:ring-4 focus:ring-lilac/20"
              type="submit"
            >
              <ArrowRight aria-hidden="true" size={20} />
            </button>
          </div>
          <p aria-live="polite" className="mt-2 min-h-5 text-sm text-red-600" role="alert">
            {error}
          </p>
        </form>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
          <Users aria-hidden="true" size={15} />
          Just you and one favorite human
        </div>
      </section>
    </main>
  );
}

export default Home;
