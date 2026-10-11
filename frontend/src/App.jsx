import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Room from './pages/Room.jsx';
import { clearCurrentRoom, socket } from './socket.js';

function App() {
  useEffect(() => {
    const handleDisconnect = () => clearCurrentRoom();
    socket.on('disconnect', handleDisconnect);
    socket.connect();

    return () => {
      socket.off('disconnect', handleDisconnect);
      socket.disconnect();
    };
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:roomId" element={<Room />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

export default App;
